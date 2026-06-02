export function formatCount(value: unknown): string {
  if (typeof value !== 'number') return '0';
  return new Intl.NumberFormat().format(value);
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
