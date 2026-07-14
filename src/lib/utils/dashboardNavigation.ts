export type DashboardView =
  | 'status'
  | 'assets'
  | 'ingestion'
  | 'preprocessing'
  | 'segmentation'
  | 'roi_refinement'
  | 'explorer'
  | 'frames'
  | 'rois'
  | 'logs'
  | 'admin';

export type DashboardViewDefinition = {
  id: DashboardView;
  label: string;
  detail: string;
  group: 'analysis' | 'workflow' | 'system';
  nextView?: DashboardView;
};

export const defaultDashboardView: DashboardView = 'rois';

export const dashboardViews: DashboardViewDefinition[] = [
  { id: 'rois', label: 'ROI Browser', detail: 'detections gallery', group: 'analysis' },
  { id: 'frames', label: 'Frame Browser', detail: 'raw and processed frames', group: 'analysis' },
  { id: 'explorer', label: 'Explorer', detail: 'live preview', group: 'analysis' },
  { id: 'status', label: 'Status', detail: 'queue and workers', group: 'system' },
  { id: 'admin', label: 'Administration', detail: 'projects and users', group: 'system' },
  { id: 'assets', label: 'Assets', detail: 'asset catalog', group: 'workflow', nextView: 'ingestion' },
  { id: 'ingestion', label: 'Ingestion', detail: 'server assets', group: 'workflow', nextView: 'preprocessing' },
  { id: 'preprocessing', label: 'Preprocessing', detail: 'queue frame prep', group: 'workflow', nextView: 'segmentation' },
  { id: 'segmentation', label: 'Candidate ROIs', detail: 'queue ROI jobs', group: 'workflow', nextView: 'roi_refinement' },
  { id: 'roi_refinement', label: 'ROI Refinement', detail: 'queue refined ROIs', group: 'workflow', nextView: 'rois' },
  { id: 'logs', label: 'Event Log', detail: 'job events', group: 'system' }
];

const dashboardViewIds = new Set<DashboardView>(dashboardViews.map((view) => view.id));

export function dashboardViewFromParam(value: string | null | undefined): DashboardView {
  return dashboardViewIds.has(value as DashboardView) ? (value as DashboardView) : defaultDashboardView;
}

export function dashboardViewDefinition(view: DashboardView): DashboardViewDefinition {
  return dashboardViews.find((candidate) => candidate.id === view) ?? dashboardViews[0];
}

export function dashboardViewHref(view: DashboardView, currentUrl?: URL): string {
  const url = currentUrl ? new URL(currentUrl) : new URL('http://pelagia.local/');
  url.pathname = '/';
  url.searchParams.set('view', view);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function roiBrowserHref(
  params: { asset_id?: string | null; frame_num?: number | string | null; frame_id?: string | null },
  currentUrl?: URL
): string {
  const url = currentUrl ? new URL(currentUrl) : new URL('http://pelagia.local/');
  url.pathname = '/';
  url.searchParams.set('view', 'rois');
  if (params.asset_id) {
    url.searchParams.set('asset_id', params.asset_id);
  } else {
    url.searchParams.delete('asset_id');
  }
  if (params.frame_num !== undefined && params.frame_num !== null && params.frame_num !== '') {
    url.searchParams.set('frame_num', String(params.frame_num));
  } else {
    url.searchParams.delete('frame_num');
  }
  if (params.frame_id) {
    url.searchParams.set('frame_id', params.frame_id);
  } else {
    url.searchParams.delete('frame_id');
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
