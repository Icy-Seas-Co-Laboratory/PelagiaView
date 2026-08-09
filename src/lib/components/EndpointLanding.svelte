<script lang="ts">
  import { browser } from '$app/environment';
  import { get } from 'svelte/store';
  import { ApiError, PelagiaApiClient } from '$lib/api/client';
  import {
    beginProjectSelectionLogin,
    cancelProjectSelectionLogin,
    completeProjectSelectionLogin,
    connectSession,
    getClient,
    session,
    type ProjectSelectionLogin
  } from '$lib/stores/session';
  import type { DirectoryListing, ProjectSummary, SystemConfigResponse } from '$lib/api/types';
  import {
    codecAvailable,
    codecUnavailableTitle,
    ensureAvailableCodec,
    type CodecAvailability
  } from '$lib/utils/codecs';
  import { scrubSessionLoginPrefillFromCurrentUrl, sessionLoginPrefillFromUrl } from '$lib/utils/sessionLoginPrefill';

  const initialLoginPrefill = browser ? sessionLoginPrefillFromUrl(new URL(window.location.href)) : {};

  let endpoint = initialLoginPrefill.endpoint ?? $session.baseUrl;
  let username = initialLoginPrefill.username ?? '';
  let password = initialLoginPrefill.password ?? '';
  let pendingLogin: ProjectSelectionLogin | null = null;
  let selectedProjectId = '';
  let selectingProject = false;
  let localError: string | null = null;
  let projectSetupOpen = false;
  let creatingProject = false;
  let projectKey = '';
  let projectName = '';
  let projectDescription = '';
  let kvstoreDirectory = '';
  let kvstoreDirectoryTouched = false;
  let kvstorePathSuggestions: string[] = [];
  let kvstoreName = '';
  let kvstoreNameTouched = false;
  let projectFrameStorageEncoding = 'zstd';
  let projectFrameStorageQuality = 90;
  let projectRoiStorageEncoding = 'auto';
  let imageCodecAvailability: CodecAvailability = {};

  $: frameStorageOptions = ['zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'];
  $: roiStorageOptions = ['auto', 'zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'];
  $: if (!kvstoreNameTouched) kvstoreName = suggestedKvstoreName(projectKey);

  async function connect() {
    localError = null;
    try {
      pendingLogin = await beginProjectSelectionLogin({
        baseUrl: endpoint,
        username,
        password
      });
      scrubSessionLoginPrefillFromCurrentUrl();
      selectedProjectId = pendingLogin.projects[0]?.id ?? '';
      selectingProject = false;
      if (pendingLogin.projectCreationRequired || pendingLogin.projects.length < 1) {
        projectSetupOpen = true;
        await loadProjectSetupCapabilities();
      }
      password = '';
    } catch (error) {
      if (isProjectCreationRequired(error)) {
        localError = null;
        pendingLogin = null;
        selectedProjectId = '';
        projectSetupOpen = true;
        await loadProjectSetupCapabilities();
      } else {
        localError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  async function openSelectedProject() {
    if (!pendingLogin || !selectedProjectId) return;
    selectingProject = true;
    localError = null;
    try {
      await completeProjectSelectionLogin(pendingLogin, selectedProjectId);
      pendingLogin = null;
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      selectingProject = false;
    }
  }

  async function useDifferentLogin() {
    const draft = pendingLogin;
    pendingLogin = null;
    selectedProjectId = '';
    selectingProject = false;
    projectSetupOpen = false;
    await cancelProjectSelectionLogin(draft);
  }

  function openProjectSetup() {
    localError = null;
    projectSetupOpen = true;
    void loadProjectSetupCapabilities();
  }

  function closeProjectSetup() {
    projectSetupOpen = false;
    creatingProject = false;
  }

  async function loadProjectSetupCapabilities() {
    try {
      const client = new PelagiaApiClient(endpoint);
      const [capabilities, config, roots] = await Promise.all([
        client.systemCapabilities().catch(() => null),
        client.systemConfig().catch(() => null),
        client.listRawDirectory('.').catch(() => null)
      ]);
      imageCodecAvailability = capabilities?.supported?.image_codec_availability ?? {};
      projectFrameStorageEncoding = availableFrameStorageEncoding(projectFrameStorageEncoding);
      projectRoiStorageEncoding = availableRoiStorageEncoding(projectRoiStorageEncoding);
      const defaultDirectory = systemKvstoreDirectory(config) ?? kvstoreRootFromListing(roots) ?? '.';
      if (!kvstoreDirectoryTouched || !kvstoreDirectory.trim() || kvstoreDirectory === '.') {
        kvstoreDirectory = defaultDirectory;
      }
      rememberKvstoreSuggestions([
        defaultDirectory,
        kvstoreDirectory,
        ...(roots?.entries ?? []).map((entry) => entry.path)
      ]);
    } catch {
      imageCodecAvailability = {};
    }
  }

  function updateTypedKvstoreDirectory() {
    kvstoreDirectoryTouched = true;
    rememberKvstoreSuggestions([kvstoreDirectory]);
  }

  async function startNewProject() {
    if (!projectKey.trim() || !kvstoreDirectory.trim() || !kvstoreName.trim()) return;
    creatingProject = true;
    localError = null;
    try {
      const storageSettings = {
        frame_encoding: availableFrameStorageEncoding(projectFrameStorageEncoding),
        frame_quality: normalizeFrameStorageQuality(projectFrameStorageQuality),
        roi_encoding: availableRoiStorageEncoding(projectRoiStorageEncoding)
      };
      if (pendingLogin?.token) {
        const bootstrapClient = new PelagiaApiClient(pendingLogin.baseUrl, { token: pendingLogin.token });
        const response = await bootstrapClient.createProject({
          project_key: projectKey.trim(),
          project_name: projectName.trim() || undefined,
          description: projectDescription.trim() || undefined,
          kvstore_directory: kvstoreDirectory.trim(),
          kvstore_name: kvstoreName.trim(),
          is_active: true
        });
        const projectId = response.project.id || response.project.project_key;
        if (projectId) {
          await bootstrapClient.updateProjectStorageSettings(projectId, storageSettings);
          await completeProjectSelectionLogin(
            {
              ...pendingLogin,
              projects: [response.project],
              loginProject: null
            },
            response.project.id
          );
        }
      } else {
        await connectSession({
          baseUrl: endpoint,
          username,
          password,
          createProject: {
            project_key: projectKey.trim(),
            project_name: projectName.trim() || undefined,
            description: projectDescription.trim() || undefined,
            kvstore_directory: kvstoreDirectory.trim(),
            kvstore_name: kvstoreName.trim(),
            is_active: true
          }
        });
        scrubSessionLoginPrefillFromCurrentUrl();
        const activeClient = getClient();
        const activeProject = get(session).project;
        const projectId = activeProject?.id ?? activeProject?.project_key;
        if (activeClient && projectId) {
          await activeClient.updateProjectStorageSettings(projectId, storageSettings);
        }
      }
      pendingLogin = null;
      selectedProjectId = '';
      projectSetupOpen = false;
      password = '';
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingProject = false;
    }
  }

  function projectLabel(project: ProjectSummary): string {
    const label = project.project_name ?? project.name ?? project.project_key ?? project.id;
    return project.project_key && label !== project.project_key ? `${label} (${project.project_key})` : label;
  }

  function isProjectCreationRequired(error: unknown): boolean {
    if (error instanceof ApiError && (error.status === 403 || error.status === 409)) {
      const outerDetail = error.detail;
      const detail = objectValue(outerDetail).detail ?? outerDetail;
      if (objectValue(detail).code === 'project_creation_required') return true;
      const message = `${String(error.message)} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.toLowerCase();
      return (
        message.includes('project_creation_required') ||
        message.includes('no project exists') ||
        message.includes('does not belong to any active project') ||
        message.includes("doesn't belong to any active project")
      );
    }
    return false;
  }

  function suggestedKvstoreName(value: string): string {
    const next = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return next ? `${next}-kvstore` : '';
  }

  function normalizeFrameStorageEncoding(value: string): string {
    return ['zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'].includes(value) ? value : 'zstd';
  }

  function normalizeRoiStorageEncoding(value: string): string {
    return ['auto', 'zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'].includes(value) ? value : 'auto';
  }

  function availableFrameStorageEncoding(value: string): string {
    return ensureAvailableCodec(normalizeFrameStorageEncoding(value), frameStorageOptions, imageCodecAvailability, 'zstd');
  }

  function availableRoiStorageEncoding(value: string): string {
    return ensureAvailableCodec(normalizeRoiStorageEncoding(value), roiStorageOptions, imageCodecAvailability, 'auto');
  }

  function normalizeFrameStorageQuality(value: number): number {
    const next = Math.round(Number(value));
    if (!Number.isFinite(next)) return 90;
    return Math.max(0, Math.min(100, next));
  }

  function systemKvstoreDirectory(config: SystemConfigResponse | null): string | null {
    const effective = objectValue(config?.effective);
    const kvstore = objectValue(effective.kvstore);
    return stringValue(kvstore.directory);
  }

  function kvstoreRootFromListing(listing: DirectoryListing | null): string | null {
    const entry = (listing?.entries ?? []).find((candidate) => candidate.key === 'kvstore');
    return entry?.path ?? null;
  }

  function rememberKvstoreSuggestions(paths: Array<string | null | undefined>) {
    const next = new Set(kvstorePathSuggestions);
    for (const path of paths) {
      const trimmed = path?.trim();
      if (trimmed) next.add(trimmed);
    }
    kvstorePathSuggestions = Array.from(next).sort((a, b) => a.localeCompare(b));
  }

  function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }
</script>

<main class="landing">
  <section class="landing-panel">
    <div class="brand-lockup">
      <img class="brand-logo" src="/brand/pelagia_logo.png" alt="Pelagia" />
      <div>
        <p class="eyebrow">PelagiaView</p>
        <h1>Connect to a Pelagia server</h1>
      </div>
    </div>

    <form class="connect-form" on:submit|preventDefault={connect}>
      <label for="endpoint">Server endpoint</label>
      <div class="endpoint-row">
        <input
          id="endpoint"
          bind:value={endpoint}
          inputmode="url"
          autocomplete="url"
          placeholder="http://127.0.0.1:8000"
        />
        <button type="submit" disabled={$session.connecting}>
          {$session.connecting ? 'Connecting' : 'Connect'}
        </button>
      </div>
      <div class="credential-grid">
        <label>
          <span>Username</span>
          <input bind:value={username} autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input bind:value={password} type="password" autocomplete="current-password" required />
        </label>
      </div>
      {#if !projectSetupOpen && (localError ?? $session.error)}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}
    </form>

    <div class="endpoint-notes">
      <p>PelagiaView keeps the active endpoint and session token in browser storage. Passwords stay out of local storage.</p>
      <p>After credentials are accepted, choose the project to open.</p>
    </div>
  </section>
</main>

{#if pendingLogin && !projectSetupOpen}
  <div class="modal-backdrop project-login-backdrop">
    <div class="project-login-modal" role="dialog" aria-modal="true" aria-labelledby="project-login-title">
      <header class="panel-heading">
        <div>
          <p class="eyebrow">Project access</p>
          <h2 id="project-login-title">Choose a project</h2>
        </div>
      </header>

      <div class="project-login-summary">
        <div>
          <span>Server</span>
          <strong>{pendingLogin.baseUrl}</strong>
        </div>
        <div>
          <span>User</span>
          <strong>{pendingLogin.user?.display_name ?? pendingLogin.user?.username ?? username}</strong>
        </div>
      </div>

      <div class="project-login-list" role="radiogroup" aria-label="Available projects">
        {#if pendingLogin.projects.length}
          {#each pendingLogin.projects as project}
            <label class:active={selectedProjectId === project.id}>
              <input type="radio" bind:group={selectedProjectId} value={project.id} />
              <span>
                <strong>{projectLabel(project)}</strong>
                <small>{project.description || project.membership_role || project.role || 'Project member'}</small>
              </span>
            </label>
          {/each}
        {:else}
          <div class="project-login-empty">
            <strong>No projects are available.</strong>
            <span>Start a new project to initialize the workspace for this server.</span>
          </div>
        {/if}
      </div>

      {#if localError ?? $session.error}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}

      <div class="button-row project-login-actions">
        <button class="ghost" type="button" on:click={useDifferentLogin} disabled={selectingProject || $session.connecting}>
          Use different login
        </button>
        {#if pendingLogin.projects.length < 1}
          <button class="secondary" type="button" on:click={openProjectSetup} disabled={selectingProject || $session.connecting}>
            Start New Project
          </button>
        {/if}
        <button type="button" on:click={openSelectedProject} disabled={!selectedProjectId || selectingProject || $session.connecting}>
          {selectingProject || $session.connecting ? 'Opening' : 'Open project'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if projectSetupOpen}
  <div class="modal-backdrop project-login-backdrop">
    <div class="project-login-modal project-setup-modal" role="dialog" aria-modal="true" aria-labelledby="project-setup-title">
      <header class="panel-heading">
        <div>
          <p class="eyebrow">Project setup</p>
          <h2 id="project-setup-title">Start New Project</h2>
        </div>
      </header>

      <div class="project-login-summary">
        <div>
          <span>Server</span>
          <strong>{endpoint}</strong>
        </div>
        <div>
          <span>User</span>
          <strong>{pendingLogin?.user?.display_name ?? pendingLogin?.user?.username ?? username}</strong>
        </div>
      </div>

      <div class="form-grid compact-grid">
        <label>
          Project key
          <input bind:value={projectKey} placeholder="project-key" disabled={creatingProject || $session.connecting} required />
        </label>
        <label>
          Name
          <input bind:value={projectName} placeholder="Optional display name" disabled={creatingProject || $session.connecting} />
        </label>
        <label class="span-2">
          Description
          <input bind:value={projectDescription} placeholder="Optional project description" disabled={creatingProject || $session.connecting} />
        </label>
        <label>
          KVStore directory
          <input
            bind:value={kvstoreDirectory}
            list="login-kvstore-directory-suggestions"
            placeholder="/path/to/kvstores"
            autocomplete="off"
            disabled={creatingProject || $session.connecting}
            required
            on:input={updateTypedKvstoreDirectory}
          />
          <datalist id="login-kvstore-directory-suggestions">
            {#each kvstorePathSuggestions as path}
              <option value={path}></option>
            {/each}
          </datalist>
        </label>
        <label>
          KVStore name
          <input
            bind:value={kvstoreName}
            placeholder="project-kvstore"
            disabled={creatingProject || $session.connecting}
            required
            on:input={() => { kvstoreNameTouched = true; }}
          />
        </label>
        <label>
          Frame encoding
          <select bind:value={projectFrameStorageEncoding} disabled={creatingProject || $session.connecting}>
            {#each frameStorageOptions as encoding}
              <option
                value={encoding}
                disabled={!codecAvailable(imageCodecAvailability, encoding)}
                title={codecUnavailableTitle(imageCodecAvailability, encoding)}
              >{encoding}</option>
            {/each}
          </select>
        </label>
        <label>
            Frame quality (0–100)
          <input type="number" min="0" max="100" bind:value={projectFrameStorageQuality} disabled={creatingProject || $session.connecting} />
        </label>
        <label>
          ROI encoding
          <select bind:value={projectRoiStorageEncoding} disabled={creatingProject || $session.connecting}>
            {#each roiStorageOptions as encoding}
              <option
                value={encoding}
                disabled={!codecAvailable(imageCodecAvailability, encoding)}
                title={codecUnavailableTitle(imageCodecAvailability, encoding)}
              >{encoding}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if localError}
        <p class="form-error">{localError}</p>
      {/if}

      <div class="button-row project-login-actions">
        <button class="ghost" type="button" on:click={pendingLogin ? closeProjectSetup : useDifferentLogin} disabled={creatingProject || $session.connecting}>
          {pendingLogin ? 'Back' : 'Use different login'}
        </button>
        <button
          type="button"
          on:click={startNewProject}
          disabled={creatingProject || $session.connecting || !projectKey.trim() || !kvstoreDirectory.trim() || !kvstoreName.trim()}
        >
          {creatingProject || $session.connecting ? 'Creating' : 'Create and open project'}
        </button>
      </div>
    </div>
  </div>
{/if}
