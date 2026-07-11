import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { PelagiaApiClient, normalizeBaseUrl, setActiveApiToken } from '$lib/api/client';
import type { AuthLoginResponse, AuthUserSummary, HealthResponse, ProjectSummary, SystemStatus } from '$lib/api/types';
import { recordSessionEvent } from '$lib/utils/analytics';
import { clearPreferences, uiStatePreferenceKeys } from '$lib/utils/preferenceRegistry';

const STORAGE_KEY = 'pelagia-view-session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type StoredSession = {
  baseUrl?: string;
  token?: string | null;
  user?: AuthUserSummary | null;
  project?: ProjectSummary | null;
  projects?: ProjectSummary[];
  active?: boolean;
  connectedAt?: string | null;
  expiresAt?: string | null;
};

export type ConnectSessionInput = {
  baseUrl: string;
  username: string;
  password: string;
  projectId?: string | null;
  projectKey?: string | null;
};

export type ProjectSelectionLogin = {
  baseUrl: string;
  token: string;
  user: AuthUserSummary | null;
  projects: ProjectSummary[];
  health: HealthResponse;
  loginProject: ProjectSummary | null;
  expiresAt: string;
};

export type SessionState = {
  baseUrl: string;
  token: string | null;
  user: AuthUserSummary | null;
  project: ProjectSummary | null;
  projects: ProjectSummary[];
  connected: boolean;
  connecting: boolean;
  switchingProject: boolean;
  error: string | null;
  health: HealthResponse | null;
  systemStatus: SystemStatus | null;
  connectedAt: string | null;
};

const initialStoredSession = browser ? readStoredSession() : null;
const initialBaseUrl = initialStoredSession?.baseUrl ?? 'http://127.0.0.1:8000';
const initialShouldRestore = shouldRestoreStoredSession(initialStoredSession);

export const session = writable<SessionState>({
  baseUrl: initialBaseUrl,
  token: null,
  user: initialStoredSession?.user ?? null,
  project: initialStoredSession?.project ?? null,
  projects: initialStoredSession?.projects ?? [],
  connected: false,
  connecting: initialShouldRestore,
  switchingProject: false,
  error: null,
  health: null,
  systemStatus: null,
  connectedAt: null
});

let client: PelagiaApiClient | null = null;

export function getClient(): PelagiaApiClient | null {
  const state = get(session);
  if (!state.connected) return null;
  if (
    !client ||
    client.baseUrl !== normalizeBaseUrl(state.baseUrl) ||
    client.token !== state.token
  ) {
    client = new PelagiaApiClient(state.baseUrl, { token: state.token });
  }
  return client;
}

export async function connectSession(input: ConnectSessionInput): Promise<void> {
  await establishSession(input, { persistActive: true });
}

export async function beginProjectSelectionLogin(input: ConnectSessionInput): Promise<ProjectSelectionLogin> {
  const normalized = normalizeBaseUrl(input.baseUrl);
  session.update((state) => ({ ...state, baseUrl: normalized, connecting: true, error: null }));
  const loginClient = new PelagiaApiClient(normalized);

  try {
    const health = await loginClient.health();
    const login = await loginClient.login({
      username: input.username,
      password: input.password,
      metadata: { client: 'PelagiaView' }
    });
    const temporaryClient = new PelagiaApiClient(normalized, { token: login.token });
    const [me, listedProjects] = await Promise.all([
      temporaryClient.authMe().catch(() => null),
      temporaryClient.listProjects().catch(() => [])
    ]);
    const projects = me?.projects?.length ? me.projects : listedProjects.length ? listedProjects : login.project ? [login.project] : [];
    if (projects.length < 1) {
      await temporaryClient.logout().catch(() => undefined);
      throw new Error('No projects are available for this login.');
    }
    session.update((state) => ({ ...state, connecting: false, error: null }));
    return {
      baseUrl: normalized,
      token: login.token,
      user: me?.user ?? login.user ?? null,
      projects,
      health,
      loginProject: me?.project ?? login.project ?? null,
      expiresAt: login.session?.expires_at ?? new Date(Date.now() + SESSION_TTL_MS).toISOString()
    };
  } catch (error) {
    session.update((state) => ({
      ...state,
      token: null,
      user: null,
      project: null,
      projects: [],
      connected: false,
      connecting: false,
      switchingProject: false,
      error: error instanceof Error ? error.message : String(error),
      health: null,
      systemStatus: null,
      connectedAt: null
    }));
    recordSessionEvent('client_session_failed', {
      base_origin: baseOrigin(normalized),
      restoring: false,
      error_name: error instanceof Error ? error.name : 'UnknownError'
    });
    throw error;
  }
}

export async function completeProjectSelectionLogin(draft: ProjectSelectionLogin, projectId: string): Promise<void> {
  if (!projectId) throw new Error('Choose a project to continue.');
  session.update((state) => ({ ...state, baseUrl: draft.baseUrl, connecting: true, error: null }));
  const temporaryClient = new PelagiaApiClient(draft.baseUrl, { token: draft.token });

  try {
    const selectedProject = draft.projects.find((candidate) => candidate.id === projectId) ?? null;
    if (!selectedProject) throw new Error('Choose a valid project to continue.');
    const login: AuthLoginResponse = selectedProject.id === draft.loginProject?.id
      ? {
          token: draft.token,
          user: draft.user ?? undefined,
          project: selectedProject,
          session: {
            project_id: selectedProject.id,
            project_key: selectedProject.project_key,
            expires_at: draft.expiresAt
          }
        }
      : await temporaryClient.switchProject({ project_id: projectId, metadata: { client: 'PelagiaView' } });
    await finishAuthenticatedSession(draft.baseUrl, login, draft.health, { persistActive: true, restoring: false, fallbackProjects: draft.projects });
  } catch (error) {
    session.update((state) => ({
      ...state,
      connected: false,
      connecting: false,
      switchingProject: false,
      error: error instanceof Error ? error.message : String(error)
    }));
    recordSessionEvent('client_session_failed', {
      base_origin: baseOrigin(draft.baseUrl),
      restoring: false,
      error_name: error instanceof Error ? error.name : 'UnknownError'
    });
    throw error;
  }
}

export async function cancelProjectSelectionLogin(draft: ProjectSelectionLogin | null): Promise<void> {
  if (draft?.token) {
    await new PelagiaApiClient(draft.baseUrl, { token: draft.token }).logout().catch(() => undefined);
  }
  session.update((state) => ({ ...state, connecting: false, error: null }));
}

export async function restoreSession(): Promise<void> {
  if (!browser) return;
  const stored = readStoredSession();
  if (!shouldRestoreStoredSession(stored) || !stored?.baseUrl || !stored.token) {
    session.update((state) => ({ ...state, connecting: false }));
    persistStoredSession({ baseUrl: stored?.baseUrl ?? get(session).baseUrl, active: false });
    return;
  }
  try {
    await restoreStoredSession(stored);
  } catch {
    persistStoredSession({ baseUrl: stored.baseUrl, active: false });
  }
}

export function skipSessionRestore(baseUrl?: string): void {
  const nextBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : get(session).baseUrl;
  client = null;
  setActiveApiToken(null);
  session.update((state) => ({
    ...state,
    baseUrl: nextBaseUrl,
    token: null,
    user: null,
    project: null,
    projects: [],
    connected: false,
    connecting: false,
    switchingProject: false,
    error: null,
    health: null,
    systemStatus: null,
    connectedAt: null
  }));
  if (browser) {
    persistStoredSession({ baseUrl: nextBaseUrl, active: false });
  }
}

async function establishSession(
  input: ConnectSessionInput,
  options: { persistActive: boolean; restoring?: boolean }
): Promise<void> {
  const normalized = normalizeBaseUrl(input.baseUrl);
  session.update((state) => ({ ...state, baseUrl: normalized, connecting: true, error: null }));
  const loginClient = new PelagiaApiClient(normalized);

  try {
    const health = await loginClient.health();
    const login = await loginClient.login({
      username: input.username,
      password: input.password,
      project_id: input.projectId,
      project_key: input.projectKey,
      metadata: { client: 'PelagiaView' }
    });
    await finishAuthenticatedSession(normalized, login, health, { persistActive: options.persistActive, restoring: Boolean(options.restoring) });
  } catch (error) {
    session.update((state) => ({
      ...state,
      token: null,
      user: null,
      project: null,
      projects: [],
      connected: false,
      connecting: false,
      switchingProject: false,
      error: error instanceof Error ? error.message : String(error),
      health: null,
      systemStatus: null,
      connectedAt: null
    }));
    if (browser && !options.restoring) {
      persistStoredSession({ baseUrl: normalized, active: false });
    }
    recordSessionEvent('client_session_failed', {
      base_origin: baseOrigin(normalized),
      restoring: Boolean(options.restoring),
      error_name: error instanceof Error ? error.name : 'UnknownError'
    });
    throw error;
  }
}

async function finishAuthenticatedSession(
  baseUrl: string,
  login: AuthLoginResponse,
  health: HealthResponse,
  options: { persistActive: boolean; restoring?: boolean; fallbackProjects?: ProjectSummary[] }
): Promise<void> {
  const nextClient = new PelagiaApiClient(baseUrl, { token: login.token });
  setActiveApiToken(login.token);
  const [me, listedProjects] = await Promise.all([
    nextClient.authMe().catch(() => null),
    nextClient.listProjects().catch(() => [])
  ]);
  const projects = me?.projects?.length
    ? me.projects
    : listedProjects.length
      ? listedProjects
      : options.fallbackProjects?.length
        ? options.fallbackProjects
        : login.project
          ? [login.project]
          : [];
  const user = me?.user ?? login.user ?? null;
  const project =
    me?.project ??
    login.project ??
    projects.find((candidate) => candidate.id === login.session?.project_id) ??
    projects.find((candidate) => candidate.project_key === login.session?.project_key) ??
    null;
  const systemStatus = await nextClient.systemStatus(project?.id ?? project?.project_key).catch(() => null);
  const connectedAt = new Date().toISOString();
  const expiresAt = login.session?.expires_at ?? new Date(Date.now() + SESSION_TTL_MS).toISOString();
  client = nextClient;
  if (browser && options.persistActive && !options.restoring) {
    clearPreferences(uiStatePreferenceKeys());
  }
  session.set({
    baseUrl,
    token: login.token,
    user,
    project,
    projects,
    connected: true,
    connecting: false,
    switchingProject: false,
    error: null,
    health,
    systemStatus,
    connectedAt
  });
  if (browser && options.persistActive) {
    persistStoredSession({
      baseUrl,
      token: login.token,
      user,
      project,
      projects,
      active: true,
      connectedAt,
      expiresAt
    });
  }
  recordSessionEvent(options.restoring ? 'client_session_restored' : 'client_session_connected', {
    base_origin: baseOrigin(baseUrl),
    project_id: project?.id ?? null,
    project_key: project?.project_key ?? null,
    username: user?.username ?? null,
    health_status: health.status,
    has_system_status: Boolean(systemStatus)
  });
}

async function restoreStoredSession(stored: StoredSession): Promise<void> {
  const normalized = normalizeBaseUrl(stored.baseUrl ?? '');
  const token = stored.token ?? null;
  session.update((state) => ({
    ...state,
    baseUrl: normalized,
    token,
    user: stored.user ?? null,
    project: stored.project ?? null,
    projects: stored.projects ?? [],
    connecting: true,
    error: null
  }));
  setActiveApiToken(token);
  const nextClient = new PelagiaApiClient(normalized, { token });

  try {
    const [health, me, listedProjects] = await Promise.all([
      nextClient.health(),
      nextClient.authMe(),
      nextClient.listProjects().catch(() => [])
    ]);
    const projects = me.projects?.length ? me.projects : listedProjects.length ? listedProjects : me.project ? [me.project] : [];
    const user = me.user ?? stored.user ?? null;
    const project = me.project ?? stored.project ?? projects.find((candidate) => candidate.id === me.auth?.project_id) ?? null;
    const systemStatus = await nextClient.systemStatus(project?.id ?? project?.project_key).catch(() => null);
    const connectedAt = stored.connectedAt ?? new Date().toISOString();
    client = nextClient;
    session.set({
      baseUrl: normalized,
      token,
      user,
      project,
      projects,
      connected: true,
      connecting: false,
      switchingProject: false,
      error: null,
      health,
      systemStatus,
      connectedAt
    });
    persistStoredSession({
      baseUrl: normalized,
      token,
      user,
      project,
      projects,
      active: true,
      connectedAt,
      expiresAt: stored.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS).toISOString()
    });
    recordSessionEvent('client_session_restored', {
      base_origin: baseOrigin(normalized),
      project_id: project?.id ?? null,
      project_key: project?.project_key ?? null,
      username: user?.username ?? null,
      health_status: health.status,
      has_system_status: Boolean(systemStatus)
    });
  } catch (error) {
    setActiveApiToken(null);
    client = null;
    session.update((state) => ({
      ...state,
      token: null,
      user: null,
      project: null,
      projects: [],
      connected: false,
      connecting: false,
      switchingProject: false,
      error: error instanceof Error ? error.message : String(error),
      health: null,
      systemStatus: null,
      connectedAt: null
    }));
    recordSessionEvent('client_session_failed', {
      base_origin: baseOrigin(normalized),
      restoring: true,
      error_name: error instanceof Error ? error.name : 'UnknownError'
    });
    throw error;
  }
}

export async function switchSessionProject(projectId: string): Promise<void> {
  const state = get(session);
  if (!state.connected || !state.token || !projectId || projectId === state.project?.id) return;
  const activeClient = getClient();
  if (!activeClient) return;
  session.update((current) => ({ ...current, switchingProject: true, error: null }));

  try {
    const nextSession = await activeClient.switchProject({ project_id: projectId, metadata: { client: 'PelagiaView' } });
    const nextClient = new PelagiaApiClient(state.baseUrl, { token: nextSession.token });
    setActiveApiToken(nextSession.token);
    const [me, listedProjects] = await Promise.all([
      nextClient.authMe().catch(() => null),
      nextClient.listProjects().catch(() => [])
    ]);
    const projects = me?.projects?.length
      ? me.projects
      : listedProjects.length
        ? listedProjects
        : nextSession.project
          ? [nextSession.project]
          : state.projects;
    const user = me?.user ?? nextSession.user ?? state.user;
    const project =
      me?.project ??
      nextSession.project ??
      projects.find((candidate) => candidate.id === projectId) ??
      state.project;
    const systemStatus = await nextClient.systemStatus(project?.id ?? project?.project_key).catch(() => null);
    const connectedAt = new Date().toISOString();
    const expiresAt = nextSession.session?.expires_at ?? new Date(Date.now() + SESSION_TTL_MS).toISOString();
    client = nextClient;
    session.update((current) => ({
      ...current,
      token: nextSession.token,
      user,
      project,
      projects,
      systemStatus,
      switchingProject: false,
      connectedAt
    }));
    if (browser) {
      persistStoredSession({
        baseUrl: state.baseUrl,
        token: nextSession.token,
        user,
        project,
        projects,
        active: true,
        connectedAt,
        expiresAt
      });
    }
    recordSessionEvent('client_session_project_switched', {
      base_origin: baseOrigin(state.baseUrl),
      project_id: project?.id ?? projectId,
      project_key: project?.project_key ?? null
    });
  } catch (error) {
    session.update((current) => ({
      ...current,
      switchingProject: false,
      error: error instanceof Error ? error.message : String(error)
    }));
    throw error;
  }
}

export async function refreshSessionProjects(): Promise<ProjectSummary[]> {
  const activeClient = getClient();
  if (!activeClient) return [];
  const projects = await activeClient.listProjects();
  session.update((current) => {
    const project =
      projects.find((candidate) => candidate.id === current.project?.id) ??
      projects.find((candidate) => candidate.project_key === current.project?.project_key) ??
      current.project;
    if (browser) {
      persistStoredSession({
        baseUrl: current.baseUrl,
        token: current.token,
        user: current.user,
        project,
        projects,
        active: current.connected,
        connectedAt: current.connectedAt,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
      });
    }
    return { ...current, project, projects };
  });
  return projects;
}

export function disconnectSession(): void {
  const state = get(session);
  const baseUrl = state.baseUrl;
  void client?.logout().catch(() => undefined);
  client = null;
  setActiveApiToken(null);
  session.update((state) => ({
    ...state,
    token: null,
    user: null,
    project: null,
    projects: [],
    connected: false,
    connecting: false,
    switchingProject: false,
    error: null,
    health: null,
    systemStatus: null,
    connectedAt: null
  }));
  if (browser) {
    persistStoredSession({ baseUrl: get(session).baseUrl, active: false });
  }
  recordSessionEvent('client_session_disconnected', {
    base_origin: baseOrigin(baseUrl)
  });
}

function readStoredSession(): StoredSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as StoredSession;
  } catch {
    return null;
  }
}

function shouldRestoreStoredSession(stored: StoredSession | null): boolean {
  if (!stored?.active || !stored.baseUrl || !stored.token || !stored.expiresAt) return false;
  return new Date(stored.expiresAt).getTime() > Date.now();
}

function persistStoredSession(stored: StoredSession): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: stored.baseUrl ?? 'http://127.0.0.1:8000',
      token: stored.token ?? null,
      user: stored.user ?? null,
      project: stored.project ?? null,
      projects: stored.projects ?? [],
      active: Boolean(stored.active),
      connectedAt: stored.connectedAt ?? null,
      expiresAt: stored.expiresAt ?? null
    })
  );
}

function baseOrigin(value: string): string {
  try {
    return new URL(normalizeBaseUrl(value)).origin;
  } catch {
    return 'unknown';
  }
}
