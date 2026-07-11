<script lang="ts">
  import { onMount } from 'svelte';
  import {
    beginProjectSelectionLogin,
    cancelProjectSelectionLogin,
    completeProjectSelectionLogin,
    session,
    type ProjectSelectionLogin
  } from '$lib/stores/session';
  import type { ProjectSummary } from '$lib/api/types';
  import { sessionLoginPrefillFromUrl } from '$lib/utils/sessionLoginPrefill';

  let endpoint = $session.baseUrl;
  let username = '';
  let password = '';
  let pendingLogin: ProjectSelectionLogin | null = null;
  let selectedProjectId = '';
  let selectingProject = false;
  let localError: string | null = null;

  onMount(() => {
    const prefill = sessionLoginPrefillFromUrl(new URL(window.location.href));
    if (prefill.endpoint) endpoint = prefill.endpoint;
    if (prefill.username) username = prefill.username;
    if (prefill.password) password = prefill.password;
  });

  async function connect() {
    localError = null;
    try {
      pendingLogin = await beginProjectSelectionLogin({
        baseUrl: endpoint,
        username,
        password
      });
      selectedProjectId = pendingLogin.projects[0]?.id ?? '';
      selectingProject = false;
      password = '';
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
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
    await cancelProjectSelectionLogin(draft);
  }

  function projectLabel(project: ProjectSummary): string {
    const label = project.project_name ?? project.name ?? project.project_key ?? project.id;
    return project.project_key && label !== project.project_key ? `${label} (${project.project_key})` : label;
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
      {#if localError ?? $session.error}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}
    </form>

    <div class="endpoint-notes">
      <p>PelagiaView keeps the active endpoint and session token in browser storage. Passwords stay out of local storage.</p>
      <p>After credentials are accepted, choose the project to open.</p>
    </div>
  </section>
</main>

{#if pendingLogin}
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
        {#each pendingLogin.projects as project}
          <label class:active={selectedProjectId === project.id}>
            <input type="radio" bind:group={selectedProjectId} value={project.id} />
            <span>
              <strong>{projectLabel(project)}</strong>
              <small>{project.description || project.membership_role || project.role || 'Project member'}</small>
            </span>
          </label>
        {/each}
      </div>

      {#if localError ?? $session.error}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}

      <div class="button-row project-login-actions">
        <button class="ghost" type="button" on:click={useDifferentLogin} disabled={selectingProject || $session.connecting}>
          Use different login
        </button>
        <button type="button" on:click={openSelectedProject} disabled={!selectedProjectId || selectingProject || $session.connecting}>
          {selectingProject || $session.connecting ? 'Opening' : 'Open project'}
        </button>
      </div>
    </div>
  </div>
{/if}
