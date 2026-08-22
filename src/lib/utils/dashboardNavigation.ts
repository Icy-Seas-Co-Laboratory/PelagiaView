import { base } from '$app/paths';

export type DashboardSection = 'analysis' | 'explorer' | 'workflow' | 'system';

export type ExplorerStage = 'preprocessing' | 'threshold' | 'detection' | 'refinement' | 'presets';

export const explorerStages: Array<{ id: ExplorerStage; label: string; detail: string }> = [
  { id: 'preprocessing', label: 'Preprocessing', detail: 'Prepare and preview a selected frame' },
  { id: 'threshold', label: 'Threshold', detail: 'Tune foreground separation' },
  { id: 'detection', label: 'Candidate ROIs', detail: 'Preview candidate detections' },
  { id: 'refinement', label: 'ROI Refinement', detail: 'Inspect refinement behavior' },
  { id: 'presets', label: 'Preset Library', detail: 'Review and save processing settings' }
];

export type DashboardView =
  | 'status'
  | 'assets'
  | 'ingestion'
  | 'telemetry'
  | 'preprocessing'
  | 'segmentation'
  | 'roi_refinement'
  | 'ml_evidence'
  | 'explorer'
  | 'frames'
  | 'rois'
  | 'curation'
  | 'logs'
  | 'admin';

export type DashboardViewDefinition = {
  id: DashboardView;
  label: string;
  shortLabel?: string;
  detail: string;
  group: DashboardSection;
  path: string;
  hidden?: boolean;
  nextView?: DashboardView;
};

export const defaultDashboardView: DashboardView = 'rois';

export const dashboardViews: DashboardViewDefinition[] = [
  { id: 'rois', label: 'ROIs', detail: 'Browse candidate and refined detections', group: 'analysis', path: 'rois' },
  { id: 'frames', label: 'Frames', detail: 'Inspect raw and processed imagery', group: 'analysis', path: 'frames', hidden: true },
  { id: 'curation', label: 'Curation', detail: 'Human and ML-assisted review', group: 'analysis', path: 'curation' },
  { id: 'explorer', label: 'Explorer', detail: 'Test processing interactively', group: 'explorer', path: 'workspace' },
  { id: 'assets', label: 'Assets', detail: 'Review the project data catalog', group: 'workflow', path: 'assets', nextView: 'ingestion' },
  { id: 'ingestion', label: 'Ingestion', shortLabel: 'Ingest', detail: 'Register source imagery', group: 'workflow', path: 'ingestion', nextView: 'preprocessing' },
  { id: 'telemetry', label: 'Telemetry', shortLabel: 'Sensors', detail: 'Review and import sensor data', group: 'workflow', path: 'telemetry', nextView: 'preprocessing' },
  { id: 'preprocessing', label: 'Preprocessing', shortLabel: 'Prepare', detail: 'Prepare frames for detection', group: 'workflow', path: 'preprocessing', nextView: 'segmentation' },
  { id: 'segmentation', label: 'Candidate ROIs', shortLabel: 'Detect', detail: 'Generate candidate detections', group: 'workflow', path: 'candidates', nextView: 'roi_refinement' },
  { id: 'roi_refinement', label: 'ROI Refinement', shortLabel: 'Refine', detail: 'Produce curatable ROIs', group: 'workflow', path: 'refinement', nextView: 'ml_evidence' },
  { id: 'ml_evidence', label: 'ML Evidence', shortLabel: 'Evidence', detail: 'Classify selected refined ROIs', group: 'workflow', path: 'ml-evidence', nextView: 'rois' },
  { id: 'status', label: 'Status', detail: 'Jobs, workers, and capacity', group: 'system', path: 'status' },
  { id: 'logs', label: 'Event Log', shortLabel: 'Logs', detail: 'Inspect operational events', group: 'system', path: 'logs' },
  { id: 'admin', label: 'Administration', shortLabel: 'Admin', detail: 'Manage projects and users', group: 'system', path: 'administration' }
];

export const dashboardSections: Array<{ id: DashboardSection; label: string; detail: string }> = [
  { id: 'analysis', label: 'Analysis', detail: 'Explore and interpret imagery' },
  { id: 'explorer', label: 'Explorer', detail: 'Tune processing interactively' },
  { id: 'workflow', label: 'Workflow', detail: 'Process source data sequentially' },
  { id: 'system', label: 'System', detail: 'Monitor and administer Pelagia' }
];

const dashboardViewIds = new Set<DashboardView>(dashboardViews.map((view) => view.id));

function applicationPath(path: string): string {
  const suffix = path.replace(/^\/+/, '');
  return `${base}/${suffix}`.replace(/\/{2,}/g, '/');
}

function pathWithinApplication(pathname: string): string {
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

export function dashboardViewFromParam(value: string | null | undefined): DashboardView {
  return dashboardViewIds.has(value as DashboardView) ? (value as DashboardView) : defaultDashboardView;
}

export function dashboardViewFromUrl(url: URL): DashboardView {
  const [section, path] = pathWithinApplication(url.pathname).split('/').filter(Boolean);
  const matched = dashboardViews.find((view) => view.group === section && view.path === path);
  return matched?.id ?? dashboardViewFromParam(url.searchParams.get('view'));
}

export function dashboardViewDefinition(view: DashboardView): DashboardViewDefinition {
  return dashboardViews.find((candidate) => candidate.id === view) ?? dashboardViews[0];
}

export function dashboardSectionViews(section: DashboardSection): DashboardViewDefinition[] {
  return dashboardViews.filter((view) => view.group === section && !view.hidden);
}

export function dashboardViewHref(view: DashboardView, currentUrl?: URL): string {
  const definition = dashboardViewDefinition(view);
  const url = currentUrl ? new URL(currentUrl) : new URL('http://pelagia.local/');
  if (currentUrl && dashboardViewDefinition(dashboardViewFromUrl(currentUrl)).group !== definition.group) {
    url.search = '';
    url.hash = '';
  }
  url.pathname = applicationPath(`${definition.group}/${definition.path}`);
  url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function explorerStageFromUrl(url: URL): ExplorerStage {
  const value = url.searchParams.get('stage') as ExplorerStage | null;
  return explorerStages.some((stage) => stage.id === value) ? value! : 'preprocessing';
}

export function explorerStageHref(stage: ExplorerStage, currentUrl?: URL): string {
  const url = new URL(dashboardViewHref('explorer', currentUrl), 'http://pelagia.local/');
  url.searchParams.set('stage', stage);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function roiBrowserHref(
  params: { asset_id?: string | null; frame_num?: number | string | null; frame_id?: string | null },
  currentUrl?: URL
): string {
  const url = new URL(dashboardViewHref('rois', currentUrl), 'http://pelagia.local/');
  if (params.asset_id) url.searchParams.set('asset_id', params.asset_id);
  else url.searchParams.delete('asset_id');
  if (params.frame_num !== undefined && params.frame_num !== null && params.frame_num !== '') {
    url.searchParams.set('frame_num', String(params.frame_num));
  } else {
    url.searchParams.delete('frame_num');
  }
  if (params.frame_id) url.searchParams.set('frame_id', params.frame_id);
  else url.searchParams.delete('frame_id');
  return `${url.pathname}${url.search}${url.hash}`;
}
