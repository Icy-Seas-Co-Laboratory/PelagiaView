export function formatCount(value: unknown): string {
  const parsed = numericValue(value);
  if (parsed === null) return '0';
  return new Intl.NumberFormat().format(parsed);
}

export function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function formatPercent(value: unknown): string {
  const parsed = numericValue(value);
  if (parsed === null) return 'Unknown';
  return `${Math.max(0, Math.min(100, parsed)).toFixed(0)}%`;
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  const elapsedMs = Date.now() - date.getTime();
  if (Number.isNaN(elapsedMs)) return value;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function formatBytes(value?: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function statusTone(value?: string | boolean | null): 'good' | 'warn' | 'bad' | 'idle' {
  if (value === true) return 'good';
  if (value === false) return 'bad';
  const normalized = String(value ?? '').toLowerCase();
  if (['ok', 'healthy', 'running', 'ready', 'completed', 'succeeded', 'active'].includes(normalized)) return 'good';
  if (['queued', 'leased', 'paused', 'pending', 'retrying'].includes(normalized)) return 'warn';
  if (['failed', 'dead_lettered', 'cancelled', 'error', 'unhealthy'].includes(normalized)) return 'bad';
  return 'idle';
}
