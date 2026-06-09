export type DashboardView = 'status' | 'ingestion' | 'preprocessing' | 'segmentation' | 'explorer' | 'rois' | 'logs';

export type DashboardViewDefinition = {
  id: DashboardView;
  label: string;
  detail: string;
};

export const dashboardViews: DashboardViewDefinition[] = [
  { id: 'status', label: 'Status', detail: 'queue and workers' },
  { id: 'ingestion', label: 'Ingestion', detail: 'server assets' },
  { id: 'preprocessing', label: 'Preprocessing', detail: 'queue frame prep' },
  { id: 'segmentation', label: 'Segmentation', detail: 'queue ROI jobs' },
  { id: 'rois', label: 'ROI Browser', detail: 'detections gallery' },
  { id: 'explorer', label: 'Explorer', detail: 'live preview' },
  { id: 'logs', label: 'Event Log', detail: 'job events' }
];

const dashboardViewIds = new Set<DashboardView>(dashboardViews.map((view) => view.id));

export function dashboardViewFromParam(value: string | null | undefined): DashboardView {
  return dashboardViewIds.has(value as DashboardView) ? (value as DashboardView) : 'status';
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
