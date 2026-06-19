<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError } from '$lib/api/client';
  import type { AuthUserSummary, DirectoryEntry, DirectoryListing, ProjectSummary } from '$lib/api/types';
  import { getClient } from '$lib/stores/session';
  import { refreshSessionProjects, session } from '$lib/stores/session';

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
  let kvstoreDirectoryPath = '.';
  let kvstoreListing: DirectoryListing | null = null;
  let kvstoreBrowserLoading = false;
  let kvstoreBrowserError: string | null = null;
  let creatingProject = false;
  let deletingProjectId = '';

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

  onMount(() => {
    void loadAdministrationData();
  });

  async function loadAdministrationData() {
    projectError = null;
    userError = null;
    await Promise.all([refreshProjects(), loadUsers(), loadKvstoreDirectory(kvstoreDirectoryPath)]);
  }

  async function loadKvstoreDirectory(path = kvstoreDirectoryPath) {
    const client = getClient();
    if (!client) return;
    kvstoreBrowserLoading = true;
    kvstoreBrowserError = null;
    try {
      const listing = await client.listRawDirectory(path);
      if (listing.source !== 'live-files') {
        kvstoreListing = { ...listing, entries: [] };
        kvstoreBrowserError = 'Live file browsing is not available from this server.';
      } else {
        kvstoreListing = {
          ...listing,
          entries: listing.entries.filter((entry) => entry.kind === 'directory')
        };
      }
      kvstoreDirectoryPath = listing.path;
    } catch (error) {
      kvstoreBrowserError = error instanceof Error ? error.message : String(error);
    } finally {
      kvstoreBrowserLoading = false;
    }
  }

  async function refreshProjects() {
    try {
      await refreshSessionProjects();
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
      const response = await client.createProject({
        project_key: projectKey.trim(),
        project_name: projectName.trim() || undefined,
        description: projectDescription.trim() || undefined,
        kvstore_root_path: kvstoreRootPath.trim() || undefined
      });
      projectMessage = `Created project ${projectLabel(response.project)}.`;
      projectKey = '';
      projectName = '';
      projectDescription = '';
      kvstoreRootPath = '';
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

  function selectUser(user: AuthUserSummary) {
    userActionTarget = user.username || user.id;
  }

  function parentPath(path: string): string {
    const normalized = path.replace(/\/+$/, '');
    if (!normalized || normalized === '.' || normalized === '/') return '.';
    const parent = normalized.split('/').slice(0, -1).join('/');
    return parent || '.';
  }

  function selectKvstoreDirectory(entry: DirectoryEntry) {
    kvstoreRootPath = entry.path;
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
          <input bind:value={kvstoreRootPath} placeholder="Server default" disabled={!canCreateProject || creatingProject} />
        </label>
      </div>
      <details class="control-details span-2">
        <summary>Browse server folders</summary>
        <div class="pathbar compact-pathbar">
          <input bind:value={kvstoreDirectoryPath} placeholder="Server folder path" disabled={!canCreateProject || kvstoreBrowserLoading} />
          <button type="button" on:click={() => loadKvstoreDirectory(kvstoreDirectoryPath)} disabled={!canCreateProject || kvstoreBrowserLoading}>
            {kvstoreBrowserLoading ? 'Opening' : 'Open'}
          </button>
        </div>
        {#if kvstoreBrowserError}
          <p class="form-error">{kvstoreBrowserError}</p>
        {/if}
        <div class="admin-directory-list" role="list" aria-label="KVStore root path folders">
          {#if kvstoreDirectoryPath}
            <button class="file-row compact-file-row" type="button" on:click={() => loadKvstoreDirectory(parentPath(kvstoreDirectoryPath))} disabled={!canCreateProject || kvstoreBrowserLoading}>
              <span class="file-icon">..</span>
              <span class="file-main">Parent folder</span>
            </button>
          {/if}
          {#each kvstoreListing?.entries ?? [] as entry}
            <button
              class="file-row compact-file-row"
              class:selected={kvstoreRootPath === entry.path}
              type="button"
              on:click={() => selectKvstoreDirectory(entry)}
              on:dblclick={() => loadKvstoreDirectory(entry.path)}
              disabled={!canCreateProject || kvstoreBrowserLoading}
            >
              <span class="file-icon">DIR</span>
              <span class="file-main">
                <strong>{entry.name}</strong>
                <small>{entry.path}</small>
              </span>
              <span>Folder</span>
            </button>
          {:else}
            <p class="empty-state">{kvstoreBrowserLoading ? 'Loading folders.' : 'No folders are visible here.'}</p>
          {/each}
        </div>
        <p class="soft">Click a folder to use it as the KVStore root path. Double-click to open it.</p>
      </details>
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
        <article class="admin-row">
          <div>
            <strong>{projectLabel(project)}</strong>
            <small>{project.description || projectRole(project)}</small>
          </div>
          <span class="status-pill {project.is_active === false ? 'bad' : 'good'}">
            {project.is_active === false ? 'Inactive' : projectRole(project)}
          </span>
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
