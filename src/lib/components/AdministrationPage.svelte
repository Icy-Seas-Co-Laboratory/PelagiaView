<script lang="ts">
  import { onMount } from 'svelte';
  import InfoChip from '$lib/components/InfoChip.svelte';
  import { ApiError } from '$lib/api/client';
  import type {
    AuthUserSummary,
    DirectoryListing,
    ProjectStorageSettingsResponse,
    ProjectSummary,
    SystemConfigResponse
  } from '$lib/api/types';
  import { getClient } from '$lib/stores/session';
  import { refreshSessionProjects, session } from '$lib/stores/session';
  import { startSystemUsagePolling, systemUsageState } from '$lib/stores/systemUsage';
  import { formatBytes } from '$lib/utils/format';
  import {
    codecAvailable,
    codecUnavailableTitle,
    ensureAvailableCodec,
    type CodecAvailability
  } from '$lib/utils/codecs';

  type ProjectStorageDraft = {
    frameEncoding: string;
    frameQuality: number;
    roiEncoding: string;
  };

  let users: AuthUserSummary[] = [];
  let usersLoading = false;
  let usersUnavailable = false;
  let usersActiveOnly = true;
  let usersIncludeAllProjects = false;
  let projectMessage: string | null = null;
  let projectError: string | null = null;
  let userMessage: string | null = null;
  let userError: string | null = null;

  let projectKey = '';
  let projectName = '';
  let projectDescription = '';
  let kvstoreRootPath = '';
  let kvstoreRootPathTouched = false;
  let kvstoreDefaultDirectory = '.';
  let kvstorePathSuggestions: string[] = [];
  let projectFrameStorageEncoding = 'zstd';
  let projectFrameStorageQuality = 90;
  let projectRoiStorageEncoding = 'auto';
  let imageCodecAvailability: CodecAvailability = {};
  let creatingProject = false;
  let deletingProjectId = '';
  let projectStorageDrafts: Record<string, ProjectStorageDraft> = {};
  let projectStorageSettingsByKey: Record<string, ProjectStorageSettingsResponse> = {};
  let updatingProjectStorageFor = '';

  let username = '';
  let password = '';
  let displayName = '';
  let role = 'viewer';
  let userIsAdmin = false;
  let targetProjectId = '';
  let creatingUser = false;

  let userActionTarget = '';
  let resetPassword = '';
  let userActionBusy = '';
  let roleDrafts: Record<string, string> = {};
  let updatingRoleFor = '';

  $: projects = $session.projects;
  $: activeProjectId = $session.project?.id ?? '';
  $: if (!targetProjectId && activeProjectId) targetProjectId = activeProjectId;
  $: canCreateProject = Boolean($session.user?.is_admin);
  $: canListAllProjectUsers = Boolean($session.user?.is_admin);
  $: if (!canListAllProjectUsers && usersIncludeAllProjects) usersIncludeAllProjects = false;
  $: frameStorageOptions = ['zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'];
  $: roiStorageOptions = ['auto', 'zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'];
  $: if (!kvstoreRootPathTouched && projectKey.trim()) {
    kvstoreRootPath = joinKvstorePath(kvstoreDefaultDirectory, suggestedKvstoreName(projectKey));
  }

  onMount(() => {
    const stopUsagePolling = startSystemUsagePolling();
    void loadAdministrationData();
    return () => stopUsagePolling();
  });

  async function loadAdministrationData() {
    projectError = null;
    userError = null;
    await Promise.all([loadSystemCapabilities(), refreshProjects(), loadUsers()]);
  }

  async function loadSystemCapabilities() {
    const client = getClient();
    if (!client) return;
    const [capabilities, config, roots] = await Promise.all([
      client.systemCapabilities().catch(() => null),
      client.systemConfig().catch(() => null),
      client.listRawDirectory('.').catch(() => null)
    ]);
    imageCodecAvailability = capabilities?.supported?.image_codec_availability ?? {};
    kvstoreDefaultDirectory = systemKvstoreDirectory(config) ?? kvstoreRootFromListing(roots) ?? '.';
    rememberKvstoreSuggestions([
      kvstoreDefaultDirectory,
      ...(roots?.entries ?? []).map((entry) => entry.path)
    ]);
  }

  async function refreshProjects() {
    try {
      const nextProjects = await refreshSessionProjects();
      projectStorageSettingsByKey = await fetchProjectStorageSettings(nextProjects);
      syncProjectStorageDrafts(nextProjects);
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    }
  }

  async function loadUsers() {
    const client = getClient();
    if (!client) return;
    usersLoading = true;
    usersUnavailable = false;
    try {
      users = await client.listUsers({
        active_only: usersActiveOnly,
        include_all_projects: usersIncludeAllProjects
      });
      syncRoleDrafts(users);
    } catch (error) {
      users = [];
      roleDrafts = {};
      usersUnavailable = true;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404 || error.status === 405)) {
        userError = 'User listing is not available for this session.';
      } else {
        userError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      usersLoading = false;
    }
  }

  async function createProject() {
    const client = getClient();
    if (!client || !projectKey.trim()) return;
    creatingProject = true;
    projectMessage = null;
    projectError = null;
    try {
      const kvstoreTarget = kvstorePartsFromRootPath(kvstoreRootPath, projectKey);
      const response = await client.createProject({
        project_key: projectKey.trim(),
        project_name: projectName.trim() || undefined,
        description: projectDescription.trim() || undefined,
        kvstore_directory: kvstoreTarget.directory,
        kvstore_name: kvstoreTarget.name
      });
      const projectId = response.project.id || response.project.project_key;
      if (projectId) {
        await client.updateProjectStorageSettings(projectId, {
          frame_encoding: availableFrameStorageEncoding(projectFrameStorageEncoding),
          frame_quality: normalizeFrameStorageQuality(projectFrameStorageQuality),
          roi_encoding: availableRoiStorageEncoding(projectRoiStorageEncoding)
        });
      }
      projectMessage = `Created project ${projectLabel(response.project)} with project storage defaults.`;
      projectKey = '';
      projectName = '';
      projectDescription = '';
      kvstoreRootPath = '';
      kvstoreRootPathTouched = false;
      projectFrameStorageEncoding = 'zstd';
      projectFrameStorageQuality = 90;
      projectRoiStorageEncoding = 'auto';
      await refreshProjects();
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingProject = false;
    }
  }

  async function deleteProject(project: ProjectSummary) {
    const client = getClient();
    const projectId = project.id || project.project_key;
    if (!client || !projectId || isDefaultProject(project)) return;
    if (!window.confirm(`Delete project ${projectLabel(project)}? Existing sessions for this project will stop validating.`)) return;
    deletingProjectId = projectId;
    projectMessage = null;
    projectError = null;
    try {
      await client.deleteProject(projectId);
      projectMessage = `Deleted project ${projectLabel(project)}.`;
      await refreshProjects();
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    } finally {
      deletingProjectId = '';
    }
  }

  async function updateProjectFrameStorage(project: ProjectSummary) {
    const client = getClient();
    const projectId = project.id || project.project_key;
    const draft = projectStorageDrafts[projectKeyForDraft(project)] ?? projectStorageDraftFor(project);
    if (!client || !projectId || !draft) return;
    updatingProjectStorageFor = projectKeyForDraft(project);
    projectMessage = null;
    projectError = null;
    try {
      const response = await client.updateProjectStorageSettings(projectId, {
        frame_encoding: availableFrameStorageEncoding(draft.frameEncoding),
        frame_quality: normalizeFrameStorageQuality(draft.frameQuality),
        roi_encoding: availableRoiStorageEncoding(draft.roiEncoding)
      });
      projectMessage = `Updated storage defaults for ${projectLabel(response.project ?? project)}.`;
      await refreshProjects();
    } catch (error) {
      projectError = error instanceof Error ? error.message : String(error);
    } finally {
      updatingProjectStorageFor = '';
    }
  }

  async function createUser() {
    const client = getClient();
    if (!client || !username.trim()) return;
    creatingUser = true;
    userMessage = null;
    userError = null;
    try {
      const response = await client.createUser({
        username: username.trim(),
        password: password || undefined,
        display_name: displayName.trim() || undefined,
        is_admin: userIsAdmin,
        is_active: true,
        project_id: targetProjectId || undefined,
        role
      });
      userMessage = `Created user ${response.user.username}.`;
      username = '';
      password = '';
      displayName = '';
      userIsAdmin = false;
      role = 'viewer';
      await loadUsers();
    } catch (error) {
      userError = error instanceof Error ? error.message : String(error);
    } finally {
      creatingUser = false;
    }
  }

  async function resetUserPassword() {
    if (!userActionTarget.trim() || !resetPassword) return;
    await runUserAction('reset-password', async (client, target) => {
      await client.resetUserPassword(target, resetPassword);
      resetPassword = '';
      return `Reset password for ${target}.`;
    });
  }

  async function deactivateUser(target = userActionTarget) {
    if (!target.trim()) return;
    await runUserAction('deactivate', async (client, resolvedTarget) => {
      await client.deactivateUser(resolvedTarget);
      return `Deactivated ${resolvedTarget}.`;
    });
  }

  async function deleteUser(target = userActionTarget) {
    if (!target.trim()) return;
    if (!window.confirm(`Delete user ${target}? This cannot be undone.`)) return;
    await runUserAction('delete', async (client, resolvedTarget) => {
      await client.deleteUser(resolvedTarget);
      return `Deleted ${resolvedTarget}.`;
    });
  }

  async function runUserAction(
    action: string,
    operation: (client: NonNullable<ReturnType<typeof getClient>>, target: string) => Promise<string>
  ) {
    const client = getClient();
    const target = userActionTarget.trim();
    if (!client || !target) return;
    userActionBusy = action;
    userMessage = null;
    userError = null;
    try {
      userMessage = await operation(client, target);
      await loadUsers();
    } catch (error) {
      userError = error instanceof Error ? error.message : String(error);
    } finally {
      userActionBusy = '';
    }
  }

  function projectLabel(project: ProjectSummary): string {
    const label = project.project_name ?? project.name ?? project.project_key ?? project.id;
    return project.project_key && label !== project.project_key ? `${label} (${project.project_key})` : label;
  }

  function projectRole(project: ProjectSummary): string {
    return project.membership_role ?? project.role ?? 'member';
  }

  function isDefaultProject(project: ProjectSummary): boolean {
    return project.id === 'default' || project.project_key === 'default';
  }

  function projectKeyForDraft(project: ProjectSummary): string {
    return project.id || project.project_key || projectLabel(project);
  }

  async function fetchProjectStorageSettings(nextProjects: ProjectSummary[]): Promise<Record<string, ProjectStorageSettingsResponse>> {
    const client = getClient();
    if (!client) return {};
    const entries = await Promise.all(
      nextProjects.map(async (project) => {
        const projectId = project.id || project.project_key;
        if (!projectId) return null;
        try {
          const settings = await client.getProjectStorageSettings(projectId);
          return [projectKeyForDraft(project), settings] as const;
        } catch {
          return null;
        }
      })
    );
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectStorageSettingsResponse] => Boolean(entry)));
  }

  function syncProjectStorageDrafts(nextProjects: ProjectSummary[]) {
    const nextDrafts: Record<string, ProjectStorageDraft> = {};
    for (const project of nextProjects) {
      const key = projectKeyForDraft(project);
      nextDrafts[key] = projectStorageDrafts[key] ?? projectStorageDraftFor(project);
    }
    projectStorageDrafts = nextDrafts;
  }

  function projectStorageDraftFor(project: ProjectSummary): ProjectStorageDraft {
    const storageSettings = projectStorageSettingsByKey[projectKeyForDraft(project)];
    const effective = storageSettings?.effective ?? {};
    const configured = storageSettings?.configured ?? objectValue(objectValue(project.settings).storage);
    const effectiveFrame = objectValue(effective.frame);
    const configuredFrame = objectValue(configured.frame);
    const effectiveRoi = objectValue(effective.roi);
    const configuredRoi = objectValue(configured.roi);
    return {
      frameEncoding: normalizeFrameStorageEncoding(
        stringValue(effectiveFrame.encoding) ?? stringValue(configuredFrame.encoding) ?? projectLegacyFrameStorageEncoding(project)
      ),
      frameQuality: normalizeFrameStorageQuality(
        numberValue(effectiveFrame.quality) ?? numberValue(configuredFrame.quality) ?? projectLegacyFrameStorageQuality(project)
      ),
      roiEncoding: normalizeRoiStorageEncoding(stringValue(effectiveRoi.encoding) ?? stringValue(configuredRoi.encoding) ?? 'auto')
    };
  }

  function projectLegacyFrameStorageEncoding(project: ProjectSummary): string {
    const metadata = project.metadata ?? {};
    const processing = objectValue(metadata.processing);
    const processingFrameStorage = objectValue(processing.frame_storage);
    const metadataFrameStorage = objectValue(metadata.frame_storage);
    const frameStorage = Object.keys(processingFrameStorage).length ? processingFrameStorage : metadataFrameStorage;
    return normalizeFrameStorageEncoding(stringValue(frameStorage.image_encoding) ?? stringValue(metadata.frame_storage_image_encoding) ?? 'zstd');
  }

  function projectLegacyFrameStorageQuality(project: ProjectSummary): number {
    const metadata = project.metadata ?? {};
    const processing = objectValue(metadata.processing);
    const processingFrameStorage = objectValue(processing.frame_storage);
    const metadataFrameStorage = objectValue(metadata.frame_storage);
    const frameStorage = Object.keys(processingFrameStorage).length ? processingFrameStorage : metadataFrameStorage;
    return normalizeFrameStorageQuality(numberValue(frameStorage.image_quality) ?? numberValue(metadata.frame_storage_image_quality) ?? 90);
  }

  function setProjectStorageDraft(project: ProjectSummary, patch: Partial<ProjectStorageDraft>) {
    const key = projectKeyForDraft(project);
    projectStorageDrafts = {
      ...projectStorageDrafts,
      [key]: {
        ...(projectStorageDrafts[key] ?? projectStorageDraftFor(project)),
        ...patch
      }
    };
  }

  function projectStorageSourceLabel(project: ProjectSummary): string {
    const sources = projectStorageSettingsByKey[projectKeyForDraft(project)]?.effective?.sources;
    if (!sources) return 'Storage defaults';
    return `Frame ${sources.frame_encoding ?? 'global'}, quality ${sources.frame_quality ?? 'global'}, ROI ${sources.roi_encoding ?? 'global'}`;
  }

  function projectStorageChanged(project: ProjectSummary): boolean {
    const draft = projectStorageDrafts[projectKeyForDraft(project)] ?? projectStorageDraftFor(project);
    const current = projectStorageDraftFor(project);
    return draft.frameEncoding !== current.frameEncoding || draft.frameQuality !== current.frameQuality || draft.roiEncoding !== current.roiEncoding;
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

  function kvstorePartsFromRootPath(rootPath: string, fallbackKey: string): { directory: string; name: string } {
    const fallbackName = suggestedKvstoreName(fallbackKey);
    const trimmed = rootPath.trim().replace(/\/+$/, '');
    if (!trimmed) return { directory: kvstoreDefaultDirectory || '.', name: fallbackName };
    const slashIndex = trimmed.lastIndexOf('/');
    if (slashIndex < 0) return { directory: '.', name: trimmed };
    if (slashIndex === 0) return { directory: '/', name: trimmed.slice(1) || fallbackName };
    return {
      directory: trimmed.slice(0, slashIndex),
      name: trimmed.slice(slashIndex + 1) || fallbackName
    };
  }

  function suggestedKvstoreName(value: string): string {
    const next = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return next ? `${next}-kvstore` : 'project-kvstore';
  }

  function joinKvstorePath(directory: string, name: string): string {
    const root = directory.trim().replace(/\/+$/, '') || '.';
    if (root === '/') return `/${name}`;
    return `${root}/${name}`;
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

  function kvstoreDiskHint(): string | null {
    const filesystem = $systemUsageState.usage?.storage?.kvstore_directory;
    if (!filesystem?.available) return null;
    const freeBytes = numberValue(filesystem.free_bytes);
    const freePercent = numberValue(filesystem.free_percent);
    if (freeBytes === null && freePercent === null) return null;
    const free = freeBytes === null ? 'Free space unknown' : `${formatBytes(freeBytes)} free`;
    const percent = freePercent === null ? '' : ` (${Math.round(freePercent)}%)`;
    return `${free}${percent}`;
  }

  function objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }

  function numberValue(value: unknown): number | null {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }

  function selectUser(user: AuthUserSummary) {
    userActionTarget = user.username || user.id;
  }

  async function updateUserRole(user: AuthUserSummary) {
    const client = getClient();
    const target = user.username || user.id;
    const projectId = activeProjectId;
    const nextRole = roleDrafts[userKey(user)] || projectRoleForUser(user);
    if (!client || !target || !projectId || !nextRole) return;
    updatingRoleFor = userKey(user);
    userMessage = null;
    userError = null;
    try {
      await client.updateProjectUserRole(projectId, target, nextRole);
      userMessage = `Updated ${target} to ${nextRole} in the current project.`;
      await loadUsers();
    } catch (error) {
      userError = error instanceof Error ? error.message : String(error);
    } finally {
      updatingRoleFor = '';
    }
  }

  function syncRoleDrafts(nextUsers: AuthUserSummary[]) {
    const nextDrafts: Record<string, string> = {};
    for (const user of nextUsers) {
      nextDrafts[userKey(user)] = roleDrafts[userKey(user)] ?? projectRoleForUser(user);
    }
    roleDrafts = nextDrafts;
  }

  function userKey(user: AuthUserSummary): string {
    return user.id || user.username;
  }

  function projectRoleForUser(user: AuthUserSummary): string {
    return user.project_role ?? user.role ?? (user.is_admin ? 'admin' : 'viewer');
  }

  function setRoleDraft(user: AuthUserSummary, value: string) {
    roleDrafts = { ...roleDrafts, [userKey(user)]: value };
  }

  function updateTypedKvstoreRootPath() {
    kvstoreRootPathTouched = true;
    rememberKvstoreSuggestions([kvstoreRootPath]);
  }
</script>

<section class="admin-layout">
  <section class="panel admin-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Projects</p>
        <h2>Manage Projects</h2>
      </div>
      <button class="ghost" type="button" on:click={refreshProjects}>Refresh</button>
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Create</p>
        <strong>New project</strong>
      </div>
      <div class="form-grid compact-grid">
        <label>
          Project key
          <input bind:value={projectKey} placeholder="project-key" disabled={!canCreateProject || creatingProject} />
        </label>
        <label>
          Name
          <input bind:value={projectName} placeholder="Optional display name" disabled={!canCreateProject || creatingProject} />
        </label>
        <label class="span-2">
          Description
          <input bind:value={projectDescription} placeholder="Optional project description" disabled={!canCreateProject || creatingProject} />
        </label>
        <label class="span-2">
          KV store root path
          <input
            bind:value={kvstoreRootPath}
            list="admin-kvstore-path-suggestions"
            placeholder={joinKvstorePath(kvstoreDefaultDirectory, suggestedKvstoreName(projectKey))}
            autocomplete="off"
            disabled={!canCreateProject || creatingProject}
            on:input={updateTypedKvstoreRootPath}
          />
          <datalist id="admin-kvstore-path-suggestions">
            {#each kvstorePathSuggestions as path}
              <option value={path}></option>
            {/each}
          </datalist>
          {#if kvstoreDiskHint()}
            <span class="soft">KVStore disk: {kvstoreDiskHint()}</span>
          {/if}
        </label>
        <label>
          <span class="field-label-row">
            Frame encoding
            <InfoChip
              label="Frame encoding help"
              text="Project default codec for stored full-frame image payloads. Faster codecs improve browsing and processing throughput; unavailable codecs are disabled."
            />
          </span>
          <select bind:value={projectFrameStorageEncoding} disabled={!canCreateProject || creatingProject}>
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
          <span class="field-label-row">
            Frame quality (0–100)
            <InfoChip
              label="Frame quality help"
              text="Quality setting for lossy frame codecs. Lossless codecs may ignore this value."
            />
          </span>
          <input type="number" min="0" max="100" bind:value={projectFrameStorageQuality} disabled={!canCreateProject || creatingProject} />
        </label>
        <label>
          <span class="field-label-row">
            ROI encoding
            <InfoChip
              label="ROI encoding help"
              text="Project default codec for stored ROI crop payloads. Auto lets the backend choose the project/global default."
            />
          </span>
          <select bind:value={projectRoiStorageEncoding} disabled={!canCreateProject || creatingProject}>
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
      <div class="button-row">
        <button type="button" on:click={createProject} disabled={!canCreateProject || creatingProject || !projectKey.trim()}>
          {creatingProject ? 'Creating' : 'Create project'}
        </button>
      </div>
      {#if !canCreateProject}
        <p class="soft">Project creation requires user-level admin permission.</p>
      {/if}
    </div>

    {#if projectMessage}<p class="success">{projectMessage}</p>{/if}
    {#if projectError}<p class="form-error">{projectError}</p>{/if}

    <div class="admin-list">
      {#each projects as project}
        {@const storageDraft = projectStorageDrafts[projectKeyForDraft(project)] ?? projectStorageDraftFor(project)}
        <article class="admin-row project-admin-row">
          <div>
            <strong>{projectLabel(project)}</strong>
            <small>{project.description || projectStorageSourceLabel(project)}</small>
          </div>
          <span class="status-pill {project.is_active === false ? 'bad' : 'good'}">
            {project.is_active === false ? 'Inactive' : projectRole(project)}
          </span>
          <label class="inline-role-select project-storage-field">
            <span class="field-label-row">
              Frame
              <InfoChip
                label="Project frame codec help"
                text="Default codec used for newly stored full-frame payloads in this project."
              />
            </span>
            <select
              value={storageDraft.frameEncoding}
              on:change={(event) => setProjectStorageDraft(project, { frameEncoding: normalizeFrameStorageEncoding((event.currentTarget as HTMLSelectElement).value) })}
              disabled={updatingProjectStorageFor === projectKeyForDraft(project)}
            >
              {#each frameStorageOptions as encoding}
                <option
                  value={encoding}
                  disabled={!codecAvailable(imageCodecAvailability, encoding)}
                  title={codecUnavailableTitle(imageCodecAvailability, encoding)}
                >{encoding}</option>
              {/each}
            </select>
          </label>
          <label class="inline-role-select project-storage-field">
            <span class="field-label-row">
              Quality (0–100)
              <InfoChip
                label="Project frame quality help"
                text="Lossy frame codec quality. Lossless codecs may ignore this setting."
              />
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={storageDraft.frameQuality}
              on:input={(event) => setProjectStorageDraft(project, { frameQuality: normalizeFrameStorageQuality(Number((event.currentTarget as HTMLInputElement).value)) })}
              disabled={updatingProjectStorageFor === projectKeyForDraft(project)}
            />
          </label>
          <label class="inline-role-select project-storage-field">
            <span class="field-label-row">
              ROI
              <InfoChip
                label="Project ROI codec help"
                text="Default codec used for newly stored ROI image payloads in this project."
              />
            </span>
            <select
              value={storageDraft.roiEncoding}
              on:change={(event) => setProjectStorageDraft(project, { roiEncoding: normalizeRoiStorageEncoding((event.currentTarget as HTMLSelectElement).value) })}
              disabled={updatingProjectStorageFor === projectKeyForDraft(project)}
            >
              {#each roiStorageOptions as encoding}
                <option
                  value={encoding}
                  disabled={!codecAvailable(imageCodecAvailability, encoding)}
                  title={codecUnavailableTitle(imageCodecAvailability, encoding)}
                >{encoding}</option>
              {/each}
            </select>
          </label>
          <button
            class="ghost"
            type="button"
            on:click={() => updateProjectFrameStorage(project)}
            disabled={updatingProjectStorageFor === projectKeyForDraft(project) || !projectStorageChanged(project)}
          >
            {updatingProjectStorageFor === projectKeyForDraft(project) ? 'Saving' : 'Save storage'}
          </button>
          <button
            class="ghost danger"
            type="button"
            on:click={() => deleteProject(project)}
            disabled={isDefaultProject(project) || deletingProjectId === project.id}
          >
            {deletingProjectId === project.id ? 'Deleting' : 'Delete'}
          </button>
        </article>
      {:else}
        <p class="empty-state">No projects are visible to this session.</p>
      {/each}
    </div>
  </section>

  <section class="panel admin-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Users</p>
        <h2>Manage Users</h2>
      </div>
      <button class="ghost" type="button" on:click={loadUsers} disabled={usersLoading}>
        {usersLoading ? 'Loading' : 'Refresh'}
      </button>
    </div>

    <div class="admin-toolbar">
      <label class="check-row">
        <input type="checkbox" bind:checked={usersActiveOnly} on:change={loadUsers} />
        Active users only
      </label>
      {#if canListAllProjectUsers}
        <label class="check-row">
          <input type="checkbox" bind:checked={usersIncludeAllProjects} on:change={loadUsers} />
          All projects
        </label>
      {/if}
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Create</p>
        <strong>Account</strong>
      </div>
      <div class="form-grid compact-grid">
        <label>
          Username
          <input bind:value={username} placeholder="username" disabled={creatingUser} />
        </label>
        <label>
          Initial password
          <input type="password" bind:value={password} placeholder="Required by server policy" disabled={creatingUser} />
        </label>
        <label>
          Display name
          <input bind:value={displayName} placeholder="Optional" disabled={creatingUser} />
        </label>
        <label>
          Project
          <select bind:value={targetProjectId} disabled={creatingUser || projects.length < 1}>
            {#each projects as project}
              <option value={project.id}>{projectLabel(project)}</option>
            {/each}
          </select>
        </label>
        <label>
          Project role
          <select bind:value={role} disabled={creatingUser}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="manager">Manager</option>
            <option value="admin">Project admin</option>
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={userIsAdmin} disabled={creatingUser} />
          User-level admin
        </label>
      </div>
      <div class="button-row">
        <button type="button" on:click={createUser} disabled={creatingUser || !username.trim()}>
          {creatingUser ? 'Creating' : 'Create user'}
        </button>
      </div>
    </div>

    <div class="form-section">
      <div class="section-heading">
        <p class="eyebrow">Actions</p>
        <strong>Existing account</strong>
      </div>
      <div class="form-grid compact-grid">
        <label>
          User id or username
          <input bind:value={userActionTarget} placeholder="username" />
        </label>
        <label>
          New password
          <input type="password" bind:value={resetPassword} placeholder="For password reset" />
        </label>
      </div>
      <div class="button-row">
        <button class="ghost" type="button" on:click={resetUserPassword} disabled={userActionBusy === 'reset-password' || !userActionTarget.trim() || !resetPassword}>
          Reset password
        </button>
        <button class="ghost" type="button" on:click={() => deactivateUser()} disabled={userActionBusy === 'deactivate' || !userActionTarget.trim()}>
          Deactivate
        </button>
        <button class="ghost danger" type="button" on:click={() => deleteUser()} disabled={userActionBusy === 'delete' || !userActionTarget.trim()}>
          Delete
        </button>
      </div>
    </div>

    {#if userMessage}<p class="success">{userMessage}</p>{/if}
    {#if userError}<p class="form-error">{userError}</p>{/if}

    {#if usersUnavailable}
      <p class="empty-state">User listing is unavailable. You can still use username or id actions above if your session has permission.</p>
    {:else}
      <div class="admin-list">
        {#each users as user}
          <article class="admin-row user-admin-row">
            <div>
              <strong>{user.display_name ?? user.username}</strong>
              <small>{user.username}{usersIncludeAllProjects && user.project_id ? ` · ${user.project_id}` : ''}</small>
            </div>
            <span class="status-pill {user.is_active === false ? 'bad' : user.is_admin ? 'warn' : 'good'}">
              {user.is_active === false ? 'Inactive' : user.is_admin ? 'Admin' : 'User'}
            </span>
            <label class="inline-role-select">
              <span>Role</span>
              <select
                value={roleDrafts[userKey(user)] ?? projectRoleForUser(user)}
                on:change={(event) => setRoleDraft(user, (event.currentTarget as HTMLSelectElement).value)}
                disabled={!activeProjectId || updatingRoleFor === userKey(user)}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="manager">Manager</option>
                <option value="admin">Project admin</option>
              </select>
            </label>
            <button
              class="ghost"
              type="button"
              on:click={() => updateUserRole(user)}
              disabled={!activeProjectId || updatingRoleFor === userKey(user) || (roleDrafts[userKey(user)] ?? projectRoleForUser(user)) === projectRoleForUser(user)}
            >
              {updatingRoleFor === userKey(user) ? 'Saving' : 'Save role'}
            </button>
            <button class="ghost" type="button" on:click={() => selectUser(user)}>Select</button>
          </article>
        {:else}
          <p class="empty-state">{usersLoading ? 'Loading users.' : 'No users returned.'}</p>
        {/each}
      </div>
    {/if}
  </section>
</section>
