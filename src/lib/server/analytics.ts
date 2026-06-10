import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type AnalyticsRecord = {
  event_type: string;
  created_at?: string;
  route?: string;
  session_id?: string | null;
  method?: string;
  status?: number;
  duration_ms?: number;
  user_agent?: string | null;
  remote_addr?: string | null;
  payload?: Record<string, unknown>;
};

const analyticsPath = resolve(process.env.PELAGIA_VIEW_ANALYTICS_PATH ?? '.pelagia-view/analytics.ndjson');

export async function recordAnalytics(record: AnalyticsRecord): Promise<void> {
  const entry = {
    created_at: record.created_at ?? new Date().toISOString(),
    ...record
  };
  try {
    await mkdir(dirname(analyticsPath), { recursive: true });
    await appendFile(analyticsPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn('PelagiaView analytics write failed', error);
  }
}
