<script lang="ts">
  import { onMount } from 'svelte';
  import HelpChip from '$lib/components/HelpChip.svelte';
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
    smallRoiEncoding: string;
    largeRoiEncoding: string;
    largeRoiMinPixels: number;
    roiQuality: number;
    maskEncoding: string;
  };

  type AdministrationSection = 'overview' | 'projects' | 'people';

  let users: AuthUserSummary[] = [];
  let userOverview: AuthUserSummary[] = [];
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
  let projectSmallRoiStorageEncoding = 'zstd';
  let projectLargeRoiStorageEncoding = 'jpg';
  let projectLargeRoiMinPixels = 50000;
  let projectRoiStorageQuality = 90;
  let projectMaskStorageEncoding = 'zstd';
  let imageCodecAvailability: CodecAvailability = {};
  let allowedStorageEncodings = ['zstd', 'jpg', 'png', 'jxl', 'jxs', 'raw'];
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
  let activeSection: AdministrationSection = 'overview';
  let projectSearch = '';
  let userSearch = '';
  let selectedProjectKey = '';
  let selectedUserKey = '';
  let createProjectOpen = false;
  let createUserOpen = false;
  let projectStorageAdvanced = false;

  $: projects = $session.projects;
  $: activeProjectId = $session.project?.id ?? '';
  $: if (!targetProjectId && activeProjectId) targetProjectId = activeProjectId;
  $: canCreateProject = Boolean($session.user?.is_admin);
  $: canListAllProjectUsers = Boolean($session.user?.is_admin);
  $: if (!canListAllProjectUsers && usersIncludeAllProjects) usersIncludeAllProjects = false;
  $: frameStorageOptions = allowedStorageEncodings;
  $: roiStorageOptions = allowedStorageEncodings;
  $: maskStorageOptions = allowedStorageEncodings.filter((encoding) => ['zstd', 'png', 'raw'].includes(encoding));
  $: filteredProjects = projects.filter((project) => searchableProject(project).includes(projectSearch.trim().toLowerCase()));
  $: filteredUsers = users.filter((user) => searchableUser(user).includes(userSearch.trim().toLowerCase()));
  $: selectedProject = projects.find((project) => projectKeyForDraft(project) === selectedProjectKey) ?? null;
  $: selectedUser = users.find((user) => userKey(user) === selectedUserKey) ?? null;
  $: if (projects.length && !projects.some((project) => projectKeyForDraft(project) === selectedProjectKey)) {
    selectedProjectKey = projectKeyForDraft(projects[0]);
  }
  $: if (users.length && !users.some((user) => userKey(user) === selectedUserKey)) selectUser(users[0]);
  $: uniqueOverviewUsers = uniqueUsers(userOverview);
  $: activeUserCount = uniqueOverviewUsers.filter((user) => user.is_active !== false).length;
  $: inactiveUserCount = uniqueOverviewUsers.filter((user) => user.is_active === false).length;
  $: unavailableCodecWarnings = projectCodecWarnings(projects);
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
    await Promise.all([loadSystemCapabilities(), refreshProjects(), loadUsers(), loadUserOverview()]);
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
    allowedStorageEncodings = capabilities?.supported?.image_storage_policy?.allowed_encodings
      ?? capabilities?.supported?.image_encodings
      ?? allowedStorageEncodings;
    projectFrameStorageEncoding = availableFrameStorageEncoding(projectFrameStorageEncoding);
    projectSmallRoiStorageEncoding = availableRoiStorageEncoding(projectSmallRoiStorageEncoding, 'zstd');
    projectLargeRoiStorageEncoding = availableRoiStorageEncoding(projectLargeRoiStorageEncoding, 'jpg');
    projectMaskStorageEncoding = availableMaskStorageEncoding(projectMaskStorageEncoding);
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

  async function loadUserOverview() {
    const client = getClient();
    if (!client) return;
    try {
      userOverview = await client.listUsers({
        active_only: false,
        include_all_projects: canListAllProjectUsers
      });
    } catch {
      userOverview = [];
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
          small_roi_encoding: availableRoiStorageEncoding(projectSmallRoiStorageEncoding, 'zstd'),
          large_roi_encoding: availableRoiStorageEncoding(projectLargeRoiStorageEncoding, 'jpg'),
          large_roi_min_pixels: normalizeRoiCutoff(projectLargeRoiMinPixels),
          roi_quality: normalizeFrameStorageQuality(projectRoiStorageQuality),
          mask_encoding: availableMaskStorageEncoding(projectMaskStorageEncoding)
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
      projectSmallRoiStorageEncoding = 'zstd';
      projectLargeRoiStorageEncoding = 'jpg';
      projectLargeRoiMinPixels = 50000;
      projectRoiStorageQuality = 90;
      projectMaskStorageEncoding = 'zstd';
      await refreshProjects();
      createProjectOpen = false;
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
    const confirmation = window.prompt(
      `Permanently delete ${projectLabel(project)}? Existing sessions will stop validating. Type ${project.project_key || project.id} to confirm.`
    );
    if (confirmation !== (project.project_key || project.id)) return;
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
        small_roi_encoding: availableRoiStorageEncoding(draft.smallRoiEncoding, 'zstd'),
        large_roi_encoding: availableRoiStorageEncoding(draft.largeRoiEncoding, 'jpg'),
        large_roi_min_pixels: normalizeRoiCutoff(draft.largeRoiMinPixels),
        roi_quality: normalizeFrameStorageQuality(draft.roiQuality),
        mask_encoding: availableMaskStorageEncoding(draft.maskEncoding)
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
      await loadUserOverview();
      createUserOpen = false;
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
    const confirmation = window.prompt(`Permanently delete ${target}? Type ${target} to confirm.`);
    if (confirmation !== target) return;
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
      await loadUserOverview();
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
      smallRoiEncoding: normalizeRoiStorageEncoding(stringValue(effectiveRoi.small_encoding) ?? stringValue(configuredRoi.small_encoding) ?? 'zstd', 'zstd'),
      largeRoiEncoding: normalizeRoiStorageEncoding(stringValue(effectiveRoi.large_encoding) ?? stringValue(configuredRoi.large_encoding) ?? 'jpg', 'jpg'),
      largeRoiMinPixels: normalizeRoiCutoff(numberValue(effectiveRoi.large_min_pixels) ?? numberValue(configuredRoi.large_min_pixels) ?? 50000),
      roiQuality: normalizeFrameStorageQuality(numberValue(effectiveRoi.quality) ?? numberValue(configuredRoi.quality) ?? 90),
      maskEncoding: normalizeRoiStorageEncoding(stringValue(effectiveRoi.mask_encoding) ?? stringValue(configuredRoi.mask_encoding) ?? 'zstd', 'zstd')
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
    return `Frame ${sources.frame_encoding ?? 'global'}; small ROI ${sources.small_roi_encoding ?? 'global'}; large ROI ${sources.large_roi_encoding ?? 'global'}`;
  }

  function projectStorageChanged(project: ProjectSummary): boolean {
    const draft = projectStorageDrafts[projectKeyForDraft(project)] ?? projectStorageDraftFor(project);
    const current = projectStorageDraftFor(project);
    return draft.frameEncoding !== current.frameEncoding
      || draft.frameQuality !== current.frameQuality
      || draft.smallRoiEncoding !== current.smallRoiEncoding
      || draft.largeRoiEncoding !== current.largeRoiEncoding
      || draft.largeRoiMinPixels !== current.largeRoiMinPixels
      || draft.roiQuality !== current.roiQuality
      || draft.maskEncoding !== current.maskEncoding;
  }

  function normalizeFrameStorageEncoding(value: string): string {
    return ['zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'].includes(value) ? value : 'zstd';
  }

  function normalizeRoiStorageEncoding(value: string, fallback = 'zstd'): string {
    return ['zstd', 'jxl', 'jxs', 'jpg', 'png', 'raw'].includes(value) ? value : fallback;
  }

  function availableFrameStorageEncoding(value: string): string {
    return ensureAvailableCodec(normalizeFrameStorageEncoding(value), frameStorageOptions, imageCodecAvailability, 'zstd');
  }

  function availableRoiStorageEncoding(value: string, fallback: string): string {
    return ensureAvailableCodec(normalizeRoiStorageEncoding(value, fallback), roiStorageOptions, imageCodecAvailability, fallback);
  }

  function availableMaskStorageEncoding(value: string): string {
    return ensureAvailableCodec(normalizeRoiStorageEncoding(value, 'zstd'), maskStorageOptions, imageCodecAvailability, 'zstd');
  }

  function normalizeRoiCutoff(value: number): number {
    return Math.max(1, Math.round(Number.isFinite(value) ? value : 50000));
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
    selectedUserKey = userKey(user);
    resetPassword = '';
  }

  async function updateUserRole(user: AuthUserSummary) {
    const client = getClient();
    const target = user.username || user.id;
    const projectId = user.project_id || activeProjectId;
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
    return `${user.id || user.username}:${user.project_id || activeProjectId || 'unscoped'}`;
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

  function searchableProject(project: ProjectSummary): string {
    return [project.project_name, project.name, project.project_key, project.id, project.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function searchableUser(user: AuthUserSummary): string {
    return [user.display_name, user.username, user.id, user.project_id, projectRoleForUser(user)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function uniqueUsers(items: AuthUserSummary[]): AuthUserSummary[] {
    return Array.from(new Map(items.map((user) => [user.id || user.username, user])).values());
  }

  function projectCodecWarnings(items: ProjectSummary[]): string[] {
    const warnings = new Set<string>();
    for (const project of items) {
      const storage = projectStorageDraftFor(project);
      for (const encoding of [storage.frameEncoding, storage.smallRoiEncoding, storage.largeRoiEncoding, storage.maskEncoding]) {
        if (!codecAvailable(imageCodecAvailability, encoding)) {
          warnings.add(`${projectLabel(project)} uses unavailable ${codecLabel(encoding)} encoding.`);
        }
      }
    }
    return Array.from(warnings);
  }

  function codecLabel(encoding: string): string {
    return ({ auto: 'Automatic', zstd: 'Zstandard', jxl: 'JPEG XL', jxs: 'JPEG XS', jpg: 'JPEG', png: 'PNG', raw: 'Raw' } as Record<string, string>)[encoding] ?? encoding.toUpperCase();
  }

  function codecDescription(encoding: string): string {
    return ({
      auto: 'Uses the server or project default.',
      zstd: 'Fast, lossless compression.',
      jxl: 'Efficient image compression with quality control.',
      jxs: 'Low-latency image compression with quality control.',
      jpg: 'Widely compatible lossy compression.',
      png: 'Lossless image compression.',
      raw: 'Uncompressed pixels; largest storage footprint.'
    } as Record<string, string>)[encoding] ?? '';
  }

  function frameQualityApplies(encoding: string): boolean {
    return ['jxl', 'jpg'].includes(encoding);
  }

  function storageSource(project: ProjectSummary, field: 'frame_encoding' | 'frame_quality' | 'small_roi_encoding' | 'large_roi_encoding' | 'large_roi_min_pixels' | 'roi_quality' | 'mask_encoding'): string {
    const source = projectStorageSettingsByKey[projectKeyForDraft(project)]?.effective?.sources?.[field];
    if (!source || source === 'global') return 'System default';
    return source === 'project' ? 'Project override' : source;
  }

  function selectProject(project: ProjectSummary) {
    selectedProjectKey = projectKeyForDraft(project);
    projectStorageAdvanced = false;
  }

  function discardProjectStorage(project: ProjectSummary) {
    projectStorageDrafts = {
      ...projectStorageDrafts,
      [projectKeyForDraft(project)]: projectStorageDraftFor(project)
    };
  }

  function openProjects(create = false) {
    activeSection = 'projects';
    if (create) createProjectOpen = true;
  }

  function openPeople(create = false) {
    activeSection = 'people';
    if (create) createUserOpen = true;
  }

  function formatLastUpdated(value: string | null): string {
    if (!value) return 'Waiting for system data';
    return `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))}`;
  }
</script>

<section class="admin-layout">
  <nav class="admin-tabs" aria-label="Administration sections">
    <div class="admin-tab-list">
      <button type="button" class:active={activeSection === 'overview'} aria-current={activeSection === 'overview' ? 'page' : undefined} on:click={() => (activeSection = 'overview')}>Overview</button>
      <button type="button" class:active={activeSection === 'projects'} aria-current={activeSection === 'projects' ? 'page' : undefined} on:click={() => openProjects()}>Projects <span>{projects.length}</span></button>
      <button type="button" class:active={activeSection === 'people'} aria-current={activeSection === 'people' ? 'page' : undefined} on:click={() => openPeople()}>People &amp; access <span>{uniqueOverviewUsers.length}</span></button>
    </div>
    <div class="admin-scope">
      <span class="scope-badge">{$session.user?.is_admin ? 'System admin' : 'Project manager'}</span>
      <span>{formatLastUpdated($systemUsageState.lastUpdatedAt)}</span>
      <button class="ghost compact-action" type="button" on:click={loadAdministrationData}>Refresh</button>
    </div>
  </nav>

  {#if activeSection === 'overview'}
    <section class="admin-overview" aria-label="Administration overview">
      {#if ($systemUsageState.usage?.stress?.alerts?.length ?? 0) > 0 || unavailableCodecWarnings.length > 0}
        <section class="attention-panel">
          <div class="section-title">
            <div><span class="section-kicker">Needs attention</span><h2>Operational checks</h2></div>
            <span class="attention-count">{($systemUsageState.usage?.stress?.alerts?.length ?? 0) + unavailableCodecWarnings.length}</span>
          </div>
          <div class="attention-list">
            {#each $systemUsageState.usage?.stress?.alerts ?? [] as alert}
              <article><span class="alert-marker {alert.level === 'critical' ? 'critical' : ''}"></span><div><strong>{alert.metric || 'System health'}</strong><p>{alert.message || 'The server reported an operational warning.'}</p></div></article>
            {/each}
            {#each unavailableCodecWarnings as warning}
              <article><span class="alert-marker"></span><div><strong>Storage compatibility</strong><p>{warning}</p></div></article>
            {/each}
          </div>
        </section>
      {:else}
        <section class="health-banner"><span class="health-dot"></span><div><strong>No administration issues detected</strong><p>Storage and configured image codecs are reporting normally.</p></div></section>
      {/if}

      <section class="admin-metrics" aria-label="Administration summary">
        <button type="button" on:click={() => openProjects()}><span>Projects</span><strong>{projects.length}</strong><small>{projects.filter((project) => project.is_active === false).length} inactive</small></button>
        <button type="button" on:click={() => openPeople()}><span>Active accounts</span><strong>{activeUserCount}</strong><small>{inactiveUserCount} inactive</small></button>
        <div><span>KV store capacity</span><strong>{kvstoreDiskHint() || 'Unavailable'}</strong><small>{kvstoreDefaultDirectory}</small></div>
        <div><span>Available codecs</span><strong>{Object.values(imageCodecAvailability).filter(Boolean).length || '—'}</strong><small>{unavailableCodecWarnings.length ? `${unavailableCodecWarnings.length} configuration warnings` : 'Configurations compatible'}</small></div>
      </section>

      <section class="quick-actions">
        <div class="section-title"><div><span class="section-kicker">Common tasks</span><h2>Quick actions</h2></div></div>
        <div class="quick-action-grid">
          <button type="button" on:click={() => openProjects(true)} disabled={!canCreateProject}><strong>New project</strong><span>Create identity and managed storage.</span></button>
          <button type="button" on:click={() => openPeople(true)}><strong>Create account</strong><span>Add an account and initial project membership.</span></button>
          <button type="button" on:click={() => openProjects()}><strong>Manage current project</strong><span>Review effective storage settings and provenance.</span></button>
        </div>
      </section>
    </section>
  {:else if activeSection === 'projects'}
    <section class="admin-workspace">
      <aside class="admin-index">
        <div class="index-toolbar">
          <label><span class="sr-only">Search projects</span><input type="search" bind:value={projectSearch} placeholder="Search projects…" /></label>
          <button type="button" on:click={() => (createProjectOpen = true)} disabled={!canCreateProject}>New project</button>
        </div>
        <div class="record-list" aria-label="Projects">
          {#each filteredProjects as project}
            {@const draft = projectStorageDrafts[projectKeyForDraft(project)] ?? projectStorageDraftFor(project)}
            <button type="button" class:selected={selectedProjectKey === projectKeyForDraft(project)} on:click={() => selectProject(project)}>
              <span class="record-main"><strong>{project.project_name || project.name || project.project_key || project.id}</strong><small>{project.project_key || project.id}</small></span>
              <span class="record-meta"><span class="status-pill {project.is_active === false ? 'bad' : 'good'}">{project.is_active === false ? 'Inactive' : projectRole(project)}</span><small>{codecLabel(draft.smallRoiEncoding)} → {codecLabel(draft.largeRoiEncoding)}</small></span>
            </button>
          {:else}<p class="empty-state">{projectSearch ? 'No projects match this search.' : 'No projects are visible to this session.'}</p>{/each}
        </div>
      </aside>

      <section class="admin-inspector">
        {#if projectMessage}<p class="admin-notice success">{projectMessage}</p>{/if}
        {#if projectError}<p class="admin-notice form-error">{projectError}</p>{/if}
        {#if selectedProject}
          {@const storageDraft = projectStorageDrafts[projectKeyForDraft(selectedProject)] ?? projectStorageDraftFor(selectedProject)}
          <header class="inspector-header"><div><span class="section-kicker">Project</span><h2>{selectedProject.project_name || selectedProject.name || selectedProject.project_key || selectedProject.id}</h2><p>{selectedProject.description || 'No project description.'}</p></div><span class="status-pill {selectedProject.is_active === false ? 'bad' : 'good'}">{selectedProject.is_active === false ? 'Inactive' : projectRole(selectedProject)}</span></header>

          <section class="inspector-section">
            <div class="section-title"><div><span class="section-kicker">Identity</span><h3>Project record</h3></div></div>
            <dl class="definition-grid"><div><dt>Project key</dt><dd>{selectedProject.project_key || selectedProject.id}</dd></div><div><dt>Project ID</dt><dd>{selectedProject.id}</dd></div><div><dt>Your role</dt><dd>{projectRole(selectedProject)}</dd></div><div><dt>State</dt><dd>{selectedProject.is_active === false ? 'Inactive' : 'Active'}</dd></div></dl>
          </section>

          <section class="inspector-section">
            <div class="section-title"><div><span class="section-kicker">Storage policy</span><h3>Image defaults</h3><p>These values apply to newly stored images in this project.</p></div><HelpChip topic="storage-policy" label="Open the image storage policy guide" eyebrow="Documentation" /></div>
            <div class="storage-form">
              <label><span>Frame encoding <small>{storageSource(selectedProject, 'frame_encoding')}</small></span><select value={storageDraft.frameEncoding} on:change={(event) => setProjectStorageDraft(selectedProject, { frameEncoding: normalizeFrameStorageEncoding((event.currentTarget as HTMLSelectElement).value) })} disabled={updatingProjectStorageFor === projectKeyForDraft(selectedProject)}>{#each frameStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)} title={codecUnavailableTitle(imageCodecAvailability, encoding)}>{codecLabel(encoding)} — {codecDescription(encoding)}</option>{/each}</select></label>
              <label><span>Frame quality (%) <small>{storageSource(selectedProject, 'frame_quality')}</small></span><input type="number" min="0" max="100" value={storageDraft.frameQuality} on:input={(event) => setProjectStorageDraft(selectedProject, { frameQuality: normalizeFrameStorageQuality(Number((event.currentTarget as HTMLInputElement).value)) })} disabled={!frameQualityApplies(storageDraft.frameEncoding) || updatingProjectStorageFor === projectKeyForDraft(selectedProject)} />{#if !frameQualityApplies(storageDraft.frameEncoding)}<small>Not used by {codecLabel(storageDraft.frameEncoding)}.</small>{/if}</label>
              <label><span>Small ROI codec <small>{storageSource(selectedProject, 'small_roi_encoding')}</small></span><select value={storageDraft.smallRoiEncoding} on:change={(event) => setProjectStorageDraft(selectedProject, { smallRoiEncoding: normalizeRoiStorageEncoding((event.currentTarget as HTMLSelectElement).value, 'zstd') })} disabled={updatingProjectStorageFor === projectKeyForDraft(selectedProject)}>{#each roiStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)} title={codecUnavailableTitle(imageCodecAvailability, encoding)}>{codecLabel(encoding)} — {codecDescription(encoding)}</option>{/each}</select></label>
              <label><span>Large ROI codec <small>{storageSource(selectedProject, 'large_roi_encoding')}</small></span><select value={storageDraft.largeRoiEncoding} on:change={(event) => setProjectStorageDraft(selectedProject, { largeRoiEncoding: normalizeRoiStorageEncoding((event.currentTarget as HTMLSelectElement).value, 'jpg') })} disabled={updatingProjectStorageFor === projectKeyForDraft(selectedProject)}>{#each roiStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)} title={codecUnavailableTitle(imageCodecAvailability, encoding)}>{codecLabel(encoding)} — {codecDescription(encoding)}</option>{/each}</select></label>
              <label><span>Large ROI cutoff (px²) <small>{storageSource(selectedProject, 'large_roi_min_pixels')}</small></span><input type="number" min="1" step="1000" value={storageDraft.largeRoiMinPixels} on:input={(event) => setProjectStorageDraft(selectedProject, { largeRoiMinPixels: normalizeRoiCutoff(Number((event.currentTarget as HTMLInputElement).value)) })} disabled={updatingProjectStorageFor === projectKeyForDraft(selectedProject)} /><small>Uses padded crop width × height.</small></label>
              <label><span>ROI quality (%) <small>{storageSource(selectedProject, 'roi_quality')}</small></span><input type="number" min="0" max="100" value={storageDraft.roiQuality} on:input={(event) => setProjectStorageDraft(selectedProject, { roiQuality: normalizeFrameStorageQuality(Number((event.currentTarget as HTMLInputElement).value)) })} disabled={!frameQualityApplies(storageDraft.largeRoiEncoding) || updatingProjectStorageFor === projectKeyForDraft(selectedProject)} />{#if !frameQualityApplies(storageDraft.largeRoiEncoding)}<small>Not used by {codecLabel(storageDraft.largeRoiEncoding)}.</small>{/if}</label>
            </div>
            <button class="advanced-toggle" type="button" aria-expanded={projectStorageAdvanced} on:click={() => (projectStorageAdvanced = !projectStorageAdvanced)}>Advanced storage details <span>{projectStorageAdvanced ? '−' : '+'}</span></button>
            {#if projectStorageAdvanced}<div class="storage-form storage-advanced"><label><span>Mask codec <small>{storageSource(selectedProject, 'mask_encoding')}</small></span><select value={storageDraft.maskEncoding} on:change={(event) => setProjectStorageDraft(selectedProject, { maskEncoding: normalizeRoiStorageEncoding((event.currentTarget as HTMLSelectElement).value, 'zstd') })} disabled={updatingProjectStorageFor === projectKeyForDraft(selectedProject)}>{#each maskStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)}>{codecLabel(encoding)} — {codecDescription(encoding)}</option>{/each}</select><small>Masks are always stored losslessly.</small></label></div><dl class="definition-grid storage-details"><div><dt>KV store</dt><dd>{selectedProject.kvstore_root_path || 'Managed by server configuration'}</dd></div><div><dt>Configuration provenance</dt><dd>{projectStorageSourceLabel(selectedProject)}</dd></div></dl>{/if}
            {#if projectStorageChanged(selectedProject)}<div class="save-bar"><span>Unsaved storage changes</span><div><button class="ghost" type="button" on:click={() => discardProjectStorage(selectedProject)} disabled={Boolean(updatingProjectStorageFor)}>Discard</button><button type="button" on:click={() => updateProjectFrameStorage(selectedProject)} disabled={Boolean(updatingProjectStorageFor)}>{updatingProjectStorageFor ? 'Saving…' : 'Save changes'}</button></div></div>{/if}
          </section>

          {#if canCreateProject}<section class="inspector-section danger-zone"><div><span class="section-kicker">Danger zone</span><h3>Delete project</h3><p>Permanently removes the project record and invalidates its active sessions.</p></div><button class="ghost danger" type="button" on:click={() => deleteProject(selectedProject)} disabled={isDefaultProject(selectedProject) || deletingProjectId === selectedProject.id}>{deletingProjectId ? 'Deleting…' : isDefaultProject(selectedProject) ? 'Default project protected' : 'Delete project'}</button></section>{/if}
        {:else}<p class="empty-state">Select a project to inspect its configuration.</p>{/if}
      </section>
    </section>
  {:else}
    <section class="admin-workspace">
      <aside class="admin-index">
        <div class="index-toolbar">
          <label><span class="sr-only">Search accounts</span><input type="search" bind:value={userSearch} placeholder="Search accounts…" /></label>
          <button type="button" on:click={() => (createUserOpen = true)}>Create account</button>
        </div>
        <div class="filter-strip"><label><input type="checkbox" bind:checked={usersActiveOnly} on:change={loadUsers} /> Active only</label>{#if canListAllProjectUsers}<label><input type="checkbox" bind:checked={usersIncludeAllProjects} on:change={loadUsers} /> All projects</label>{/if}</div>
        {#if usersUnavailable}<div class="empty-state"><p>User listing is unavailable for this session.</p><label>Username or ID<input bind:value={userActionTarget} placeholder="account name" /></label></div>{:else}
          <div class="record-list" aria-label="Accounts">
            {#each filteredUsers as user}
              <button type="button" class:selected={selectedUserKey === userKey(user)} on:click={() => selectUser(user)}><span class="record-main"><strong>{user.display_name || user.username}</strong><small>@{user.username}{user.project_id ? ` · ${user.project_id}` : ''}</small></span><span class="record-meta"><span class="status-pill {user.is_active === false ? 'bad' : user.is_admin ? 'warn' : 'good'}">{user.is_active === false ? 'Inactive' : user.is_admin ? 'System admin' : 'Active'}</span><small>{projectRoleForUser(user)}</small></span></button>
            {:else}<p class="empty-state">{usersLoading ? 'Loading accounts…' : userSearch ? 'No accounts match this search.' : 'No accounts returned.'}</p>{/each}
          </div>
        {/if}
      </aside>

      <section class="admin-inspector">
        {#if userMessage}<p class="admin-notice success">{userMessage}</p>{/if}
        {#if userError}<p class="admin-notice form-error">{userError}</p>{/if}
        {#if selectedUser}
          <header class="inspector-header"><div><span class="section-kicker">Account</span><h2>{selectedUser.display_name || selectedUser.username}</h2><p>@{selectedUser.username}</p></div><span class="status-pill {selectedUser.is_active === false ? 'bad' : selectedUser.is_admin ? 'warn' : 'good'}">{selectedUser.is_active === false ? 'Inactive' : selectedUser.is_admin ? 'System administrator' : 'Active'}</span></header>
          <section class="inspector-section"><div class="section-title"><div><span class="section-kicker">Identity</span><h3>Account record</h3></div></div><dl class="definition-grid"><div><dt>Username</dt><dd>{selectedUser.username}</dd></div><div><dt>Account ID</dt><dd>{selectedUser.id}</dd></div><div><dt>System access</dt><dd>{selectedUser.is_admin ? 'System administrator' : 'Standard account'}</dd></div><div><dt>State</dt><dd>{selectedUser.is_active === false ? 'Inactive' : 'Active'}</dd></div></dl></section>
          <section class="inspector-section">
            <div class="section-title"><div><span class="section-kicker">Project membership</span><h3>{selectedUser.project_id || $session.project?.project_name || $session.project?.project_key || 'Current project'}</h3><p>Project roles control access only within this project.</p></div></div>
            <div class="membership-editor"><label>Project role<select value={roleDrafts[userKey(selectedUser)] ?? projectRoleForUser(selectedUser)} on:change={(event) => setRoleDraft(selectedUser, (event.currentTarget as HTMLSelectElement).value)} disabled={updatingRoleFor === userKey(selectedUser)}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="manager">Manager</option><option value="admin">Project admin</option></select></label><button type="button" on:click={() => updateUserRole(selectedUser)} disabled={updatingRoleFor === userKey(selectedUser) || (roleDrafts[userKey(selectedUser)] ?? projectRoleForUser(selectedUser)) === projectRoleForUser(selectedUser)}>{updatingRoleFor ? 'Saving…' : 'Save role'}</button></div>
          </section>
          <section class="inspector-section"><div class="section-title"><div><span class="section-kicker">Security</span><h3>Reset password</h3><p>Set a temporary password according to the server password policy.</p></div></div><div class="password-action"><label>New password<input type="password" bind:value={resetPassword} autocomplete="new-password" placeholder="New temporary password" /></label><button class="ghost" type="button" on:click={resetUserPassword} disabled={userActionBusy === 'reset-password' || !resetPassword}>{userActionBusy === 'reset-password' ? 'Resetting…' : 'Reset password'}</button></div></section>
          <section class="inspector-section danger-zone"><div><span class="section-kicker">Danger zone</span><h3>Account access</h3><p>Deactivate to block sign-in while preserving the account. Permanent deletion cannot be undone.</p></div><div class="danger-actions"><button class="ghost" type="button" on:click={() => deactivateUser()} disabled={selectedUser.is_active === false || userActionBusy === 'deactivate' || selectedUser.id === $session.user?.id}>{selectedUser.is_active === false ? 'Already inactive' : userActionBusy === 'deactivate' ? 'Deactivating…' : 'Deactivate account'}</button><button class="ghost danger" type="button" on:click={() => deleteUser()} disabled={userActionBusy === 'delete' || selectedUser.id === $session.user?.id}>{userActionBusy === 'delete' ? 'Deleting…' : 'Delete account'}</button></div></section>
        {:else if usersUnavailable && userActionTarget}<section class="inspector-section"><div class="section-title"><div><span class="section-kicker">Direct account action</span><h3>{userActionTarget}</h3><p>The account could not be loaded, so identity and role details are unavailable.</p></div></div><div class="password-action"><label>New password<input type="password" bind:value={resetPassword} autocomplete="new-password" /></label><button class="ghost" type="button" on:click={resetUserPassword} disabled={!resetPassword}>Reset password</button></div><div class="danger-actions"><button class="ghost" type="button" on:click={() => deactivateUser()}>Deactivate</button><button class="ghost danger" type="button" on:click={() => deleteUser()}>Delete</button></div></section>
        {:else}<p class="empty-state">Select an account to inspect its access.</p>{/if}
      </section>
    </section>
  {/if}
</section>

{#if createProjectOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <div class="admin-modal-layer"><section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><header><div><span class="section-kicker">New project</span><h2 id="new-project-title">Create a project workspace</h2><p>Start with a stable identity and managed storage defaults.</p></div><button class="ghost dialog-close" type="button" aria-label="Close new project dialog" on:click={() => (createProjectOpen = false)}>×</button></header><div class="dialog-body"><section><h3>1. Identity</h3><div class="form-grid"><label>Project key<input bind:value={projectKey} placeholder="project-key" disabled={creatingProject} /><small>Stable identifier; treat as immutable after creation.</small></label><label>Display name<input bind:value={projectName} placeholder="Optional descriptive name" disabled={creatingProject} /></label><label class="span-2">Description<textarea bind:value={projectDescription} rows="3" placeholder="Scientific purpose or project scope" disabled={creatingProject}></textarea></label></div></section><section><h3>2. Storage</h3><div class="managed-storage"><strong>Managed project storage</strong><span>{kvstoreRootPath || joinKvstorePath(kvstoreDefaultDirectory, suggestedKvstoreName(projectKey))}</span><small>{kvstoreDiskHint() || 'Capacity information unavailable'}</small></div><details><summary>Use a custom path or codec policy</summary><div class="form-grid dialog-advanced"><label class="span-2">KV store root path<input bind:value={kvstoreRootPath} list="admin-kvstore-path-suggestions" autocomplete="off" on:input={updateTypedKvstoreRootPath} /><datalist id="admin-kvstore-path-suggestions">{#each kvstorePathSuggestions as path}<option value={path}></option>{/each}</datalist></label><label>Frame encoding<select bind:value={projectFrameStorageEncoding}>{#each frameStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)}>{codecLabel(encoding)}</option>{/each}</select></label><label>Frame quality (%)<input type="number" min="0" max="100" bind:value={projectFrameStorageQuality} disabled={!frameQualityApplies(projectFrameStorageEncoding)} /></label><label>Small ROI codec<select bind:value={projectSmallRoiStorageEncoding}>{#each roiStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)}>{codecLabel(encoding)}</option>{/each}</select></label><label>Large ROI codec<select bind:value={projectLargeRoiStorageEncoding}>{#each roiStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)}>{codecLabel(encoding)}</option>{/each}</select></label><label>Large ROI cutoff (px²)<input type="number" min="1" step="1000" bind:value={projectLargeRoiMinPixels} /></label><label>ROI quality (%)<input type="number" min="0" max="100" bind:value={projectRoiStorageQuality} disabled={!frameQualityApplies(projectLargeRoiStorageEncoding)} /></label><label>Mask codec<select bind:value={projectMaskStorageEncoding}>{#each roiStorageOptions as encoding}<option value={encoding} disabled={!codecAvailable(imageCodecAvailability, encoding)}>{codecLabel(encoding)}</option>{/each}</select></label></div></details></section></div>{#if projectError}<p class="admin-notice form-error">{projectError}</p>{/if}<footer><button class="ghost" type="button" on:click={() => (createProjectOpen = false)} disabled={creatingProject}>Cancel</button><button type="button" on:click={createProject} disabled={creatingProject || !projectKey.trim()}>{creatingProject ? 'Creating…' : 'Create project'}</button></footer></section></div>
{/if}

{#if createUserOpen}
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <div class="admin-modal-layer"><section class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="new-user-title"><header><div><span class="section-kicker">New account</span><h2 id="new-user-title">Create account and membership</h2><p>Account identity, system access, and project access remain explicit.</p></div><button class="ghost dialog-close" type="button" aria-label="Close new account dialog" on:click={() => (createUserOpen = false)}>×</button></header><div class="dialog-body"><section><h3>1. Account identity</h3><div class="form-grid"><label>Username<input bind:value={username} placeholder="username" disabled={creatingUser} /></label><label>Display name<input bind:value={displayName} placeholder="Optional" disabled={creatingUser} /></label><label class="span-2">Initial password<input type="password" bind:value={password} autocomplete="new-password" placeholder="Required by server policy" disabled={creatingUser} /></label></div></section><section><h3>2. Project membership</h3><div class="form-grid"><label>Project<select bind:value={targetProjectId} disabled={creatingUser || projects.length < 1}>{#each projects as project}<option value={project.id}>{projectLabel(project)}</option>{/each}</select></label><label>Project role<select bind:value={role} disabled={creatingUser}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="manager">Manager</option><option value="admin">Project admin</option></select></label></div></section><section class="system-access-section"><h3>3. System access</h3><label class="admin-check"><input type="checkbox" bind:checked={userIsAdmin} disabled={creatingUser || !canCreateProject} /><span><strong>System administrator</strong><small>Grants server-wide administration. This is separate from project membership.</small></span></label></section></div>{#if userError}<p class="admin-notice form-error">{userError}</p>{/if}<footer><button class="ghost" type="button" on:click={() => (createUserOpen = false)} disabled={creatingUser}>Cancel</button><button type="button" on:click={createUser} disabled={creatingUser || !username.trim()}>{creatingUser ? 'Creating…' : 'Create account'}</button></footer></section></div>
{/if}

<style>
  .admin-layout { display: block; min-height: 100%; color: #17201b; }
  .admin-scope { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: .35rem .55rem; align-items: center; color: #60746c; font-size: .76rem; }
  .scope-badge { padding: .18rem .45rem; border-radius: 999px; background: #e4f2ed; color: #175c4b; font-weight: 800; }
  .admin-tabs { display: flex; justify-content: space-between; gap: 1rem; min-height: 2.5rem; padding: 0 .85rem; border-bottom: 1px solid #dbe7e2; overflow-x: auto; }
  .admin-tab-list { display: flex; gap: .9rem; min-width: max-content; }
  .admin-tabs button { display: flex; gap: .35rem; align-items: center; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: .48rem .05rem .42rem; background: transparent; color: #60746c; white-space: nowrap; }
  .admin-tabs button.active { border-bottom-color: #17735c; color: #145b49; }
  .admin-tabs button span { display: grid; min-width: 1.15rem; height: 1.15rem; place-items: center; border-radius: 999px; background: #edf3f1; font-size: var(--wb-font-micro, .7rem); }
  .admin-tabs .compact-action { min-height: 1.8rem; border: 1px solid #cbdad5; border-radius: 4px; padding: .2rem .48rem; }
  .admin-overview { display: grid; gap: .7rem; padding: .8rem .9rem; }
  .attention-panel, .quick-actions { border: 1px solid #dbe7e2; background: #fff; }
  .attention-panel { border-left: 3px solid #c9862c; }
  .section-title { display: flex; justify-content: space-between; gap: .7rem; align-items: flex-start; padding: .68rem .8rem; }
  .section-title h2, .section-title h3, .inspector-section h3 { margin: .12rem 0 0; }
  .section-title p { margin: .25rem 0 0; color: #60746c; }
  .section-kicker { color: #60746c; font-size: var(--wb-font-micro, .7rem); font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
  .attention-count { display: grid; min-width: 1.8rem; height: 1.8rem; place-items: center; border-radius: 999px; background: #fff2dc; color: #8b5611; font-weight: 900; }
  .attention-list article { display: grid; grid-template-columns: .55rem 1fr; gap: .55rem; padding: .55rem .8rem; border-top: 1px solid #e2ebe7; }
  .attention-list p, .health-banner p { margin: .15rem 0 0; color: #60746c; }
  .alert-marker, .health-dot { width: .55rem; height: .55rem; margin-top: .28rem; border-radius: 999px; background: #d28b2e; }
  .alert-marker.critical { background: #b94444; }
  .health-banner { display: flex; gap: .6rem; align-items: flex-start; padding: .65rem .8rem; border-left: 3px solid #2d9a72; background: #f2faf7; }
  .health-dot { background: #2d9a72; }
  .admin-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid #dbe7e2; background: #f7faf9; }
  .admin-metrics > * { display: grid; gap: .12rem; min-width: 0; min-height: 4.6rem; align-content: center; border: 0; border-right: 1px solid #dbe7e2; border-radius: 0; padding: .55rem .7rem; background: transparent; color: inherit; text-align: left; }
  .admin-metrics > *:last-child { border-right: 0; }
  .admin-metrics span { color: #60746c; font-size: .76rem; font-weight: 800; text-transform: uppercase; }
  .admin-metrics strong { overflow: hidden; font-size: 1.25rem; text-overflow: ellipsis; white-space: nowrap; }
  .admin-metrics small { overflow: hidden; color: #60746c; text-overflow: ellipsis; white-space: nowrap; }
  .quick-action-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; border-top: 1px solid #dbe7e2; padding: .55rem; background: #f7faf9; }
  .quick-action-grid button { display: grid; gap: .15rem; position: relative; min-height: 4rem; border: 1px solid #b9cec7; border-radius: 5px; padding: .62rem 2.25rem .62rem .72rem; background: #fff; box-shadow: 0 1px 2px rgb(19 54 44 / 8%); color: #17201b; text-align: left; }
  .quick-action-grid button::after { content: '→'; display: grid; position: absolute; top: 50%; right: .7rem; width: 1.35rem; height: 1.35rem; place-items: center; border-radius: 999px; color: #fff; background: #357966; font-size: .78rem; transform: translateY(-50%); }
  .quick-action-grid button:hover:not(:disabled), .quick-action-grid button:focus-visible { border-color: #357966; background: #edf7f3; box-shadow: 0 2px 5px rgb(19 54 44 / 12%); }
  .quick-action-grid button:disabled::after { background: #91a49e; }
  .quick-action-grid span { color: #60746c; font-weight: 500; }
  .admin-workspace { display: grid; grid-template-columns: minmax(17rem, 26rem) minmax(0, 1fr); min-height: 0; }
  .admin-index { min-width: 0; border-right: 1px solid #dbe7e2; background: #f8fbfa; }
  .index-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .45rem; padding: .6rem .7rem; border-bottom: 1px solid #dbe7e2; }
  .index-toolbar label, .index-toolbar input { width: 100%; min-width: 0; }
  .index-toolbar input, .index-toolbar button { min-height: 2.15rem; padding-block: .35rem; }
  .filter-strip { display: flex; flex-wrap: wrap; gap: .55rem .8rem; padding: .42rem .7rem; border-bottom: 1px solid #dbe7e2; color: #52675f; font-size: .78rem; font-weight: 700; }
  .filter-strip label { display: flex; gap: .4rem; align-items: center; }
  .record-list { display: grid; max-height: calc(100vh - 11.5rem); overflow-y: auto; }
  .record-list > button { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .55rem; align-items: center; min-height: 3.55rem; border: 0; border-bottom: 1px solid #e1e9e6; border-left: 3px solid transparent; border-radius: 0; padding: .52rem .7rem .52rem .58rem; background: transparent; color: inherit; text-align: left; }
  .record-list > button:hover { background: #f0f7f4; }
  .record-list > button.selected { border-left-color: #17735c; background: #e8f4ef; }
  .record-main, .record-meta { display: grid; gap: .18rem; min-width: 0; }
  .record-main strong, .record-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .record-main small, .record-meta small { color: #60746c; }
  .record-meta { justify-items: end; }
  .admin-inspector { min-width: 0; background: #fff; }
  .inspector-header { display: flex; justify-content: space-between; gap: .7rem; align-items: flex-start; padding: .72rem .9rem; border-bottom: 1px solid #dbe7e2; }
  .inspector-header h2 { margin: .08rem 0 0; font-size: 1.18rem; }
  .inspector-header p { margin: .12rem 0 0; color: #60746c; }
  .inspector-section { padding: .72rem .9rem; border-bottom: 1px solid #dbe7e2; }
  .inspector-section > .section-title { padding: 0 0 .55rem; }
  .definition-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 0; border: 1px solid #dbe7e2; }
  .definition-grid > div { min-width: 0; padding: .48rem .62rem; border-right: 1px solid #dbe7e2; border-bottom: 1px solid #dbe7e2; }
  .definition-grid > div:nth-child(2n) { border-right: 0; }
  .definition-grid > div:nth-last-child(-n + 2) { border-bottom: 0; }
  .definition-grid dt { color: #60746c; font-size: var(--wb-font-caption, .75rem); font-weight: 800; text-transform: uppercase; }
  .definition-grid dd { overflow-wrap: anywhere; margin: .1rem 0 0; font-weight: 700; }
  .storage-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .55rem .65rem; }
  .storage-form label, .membership-editor label, .password-action label { display: grid; gap: .22rem; font-weight: 800; }
  .storage-form label > span { display: flex; justify-content: space-between; gap: .5rem; }
  .storage-form small { color: #60746c; font-weight: 500; }
  .storage-form select, .storage-form input, .membership-editor select, .password-action input { min-height: 2.15rem; padding-block: .35rem; }
  .advanced-toggle { display: flex; justify-content: space-between; width: 100%; margin-top: .65rem; border: 0; border-top: 1px solid #dbe7e2; border-radius: 0; padding: .52rem 0 0; background: transparent; color: #315a4f; text-align: left; }
  .storage-details { margin-top: .55rem; }
  .save-bar { display: flex; justify-content: space-between; gap: .7rem; align-items: center; position: sticky; bottom: 0; z-index: 2; margin: .65rem -.9rem -.72rem; padding: .5rem .9rem; border-top: 1px solid #b9d3ca; background: #eff8f4; font-weight: 800; }
  .save-bar > div, .danger-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .membership-editor, .password-action { display: grid; grid-template-columns: minmax(12rem, 1fr) auto; gap: .5rem; align-items: end; }
  .membership-editor > button, .password-action > button, .danger-zone > button, .danger-actions > button { min-height: 2.15rem; padding-block: .35rem; }
  .danger-zone { display: flex; justify-content: space-between; gap: .9rem; align-items: center; border-left: 3px solid #bd5151; background: #fffafa; }
  .danger-zone h3 { margin: .15rem 0 0; }
  .danger-zone p { max-width: 48rem; margin: .12rem 0 0; color: #6f5c5c; }
  .admin-notice { margin: .65rem .9rem 0; }
  .admin-modal-layer { display: grid; place-items: center; position: fixed; inset: 0; z-index: 100; padding: .7rem; background: rgb(8 21 17 / 45%); }
  .admin-dialog { width: min(46rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; border: 1px solid #cbdad5; border-radius: 10px; background: #fff; box-shadow: 0 1.5rem 4rem rgb(4 15 12 / 25%); }
  .admin-dialog > header, .admin-dialog > footer { display: flex; justify-content: space-between; gap: .7rem; align-items: flex-start; padding: .7rem .85rem; }
  .admin-dialog > header { border-bottom: 1px solid #dbe7e2; }
  .admin-dialog > footer { justify-content: flex-end; align-items: center; border-top: 1px solid #dbe7e2; }
  .admin-dialog h2 { margin: .15rem 0 0; }
  .admin-dialog header p { margin: .25rem 0 0; color: #60746c; }
  .dialog-close { min-width: 2.2rem; padding: .25rem; font-size: 1.4rem; }
  .dialog-body { display: grid; gap: .75rem; padding: .75rem .85rem; }
  .dialog-body section { display: grid; gap: .5rem; }
  .dialog-body h3 { margin: 0; font-size: 1rem; }
  .dialog-body .form-grid { margin: 0; }
  .dialog-body label { display: grid; gap: .35rem; font-weight: 800; }
  .dialog-body label small { color: #60746c; font-weight: 500; }
  .managed-storage { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .12rem .6rem; padding: .55rem .65rem; border-left: 3px solid #2d9a72; background: #f2faf7; }
  .managed-storage span { overflow-wrap: anywhere; }
  .managed-storage small { grid-column: 1 / -1; color: #60746c; }
  details { border-top: 1px solid #dbe7e2; padding-top: .5rem; }
  summary { color: #315a4f; font-weight: 800; cursor: pointer; }
  .dialog-advanced { margin-top: .55rem !important; }
  .system-access-section { padding: .55rem .65rem; border: 1px solid #ead6b2; background: #fffbf3; }
  .admin-check { display: grid !important; grid-template-columns: auto 1fr; align-items: flex-start; }
  .admin-check span { display: grid; gap: .15rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

  @media (max-width: 920px) {
    .admin-metrics, .quick-action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .admin-metrics > *:nth-child(2) { border-right: 0; }
    .admin-metrics > *:nth-child(-n + 2) { border-bottom: 1px solid #dbe7e2; }
    .quick-action-grid button:last-child { grid-column: 1 / -1; }
    .admin-workspace { grid-template-columns: minmax(15rem, 20rem) minmax(0, 1fr); }
    .storage-form { grid-template-columns: 1fr; }
  }
  @media (max-width: 700px) {
    .admin-overview { padding-inline: .7rem; }
    .admin-tabs { padding-inline: .7rem; }
    .admin-scope > span:not(.scope-badge) { display: none; }
    .admin-workspace { grid-template-columns: 1fr; }
    .admin-index { border-right: 0; border-bottom: 1px solid #dbe7e2; }
    .record-list { max-height: 20rem; }
    .inspector-header, .inspector-section { padding-inline: .7rem; }
    .definition-grid, .membership-editor, .password-action { grid-template-columns: 1fr; }
    .definition-grid > div { border-right: 0; border-bottom: 1px solid #dbe7e2 !important; }
    .definition-grid > div:last-child { border-bottom: 0 !important; }
    .danger-zone, .save-bar { align-items: stretch; flex-direction: column; }
    .save-bar { margin-inline: -.7rem; padding-inline: .7rem; }
  }
  @media (max-width: 480px) {
    .admin-metrics, .quick-action-grid { grid-template-columns: 1fr; }
    .admin-metrics > * { border-right: 0; border-bottom: 1px solid #dbe7e2; }
    .admin-metrics > *:last-child { border-bottom: 0; }
    .quick-action-grid button, .quick-action-grid button:last-child { grid-column: auto; border: 1px solid #b9cec7; }
    .index-toolbar { grid-template-columns: 1fr; }
    .record-list > button { grid-template-columns: 1fr; }
    .record-meta { justify-items: start; }
    .managed-storage { grid-template-columns: 1fr; }
  }
</style>
