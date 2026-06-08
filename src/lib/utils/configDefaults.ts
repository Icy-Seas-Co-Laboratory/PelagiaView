import type { SystemConfigResponse } from '$lib/api/types';

type ConfigSection = Record<string, unknown> | undefined;

export function processingSection(
  config: SystemConfigResponse | null | undefined,
  section: 'segmentation' | 'flatfield' | 'preprocessing' | 'video_ingest' | 'frame_storage'
): ConfigSection {
  return config?.effective?.processing?.[section];
}

export function numberDefault(section: ConfigSection, key: string, fallback: number): number {
  const value = section?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNumberDefault(section: ConfigSection, key: string, fallback: number | null): number | null {
  const value = section?.[key];
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanDefault(section: ConfigSection, key: string, fallback: boolean): boolean {
  const value = section?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function stringDefault(section: ConfigSection, key: string, fallback: string): string {
  const value = section?.[key];
  return typeof value === 'string' && value ? value : fallback;
}
