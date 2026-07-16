<script lang="ts">
  import { onMount } from 'svelte';
  import { startSystemUsagePolling, systemUsageState } from '$lib/stores/systemUsage';
  import type { SystemUsageFilesystem, SystemUsageResponse } from '$lib/api/types';

  type Tone = 'good' | 'warn' | 'bad' | 'unknown';

  $: usage = $systemUsageState.usage;
  $: cpuPercent = cpuPressurePercent(usage);
  $: memoryPercent = numberOrNull(usage?.memory?.used_percent);
  $: diskPercent = diskPressurePercent(usage);
  $: cpuTone = pressureTone(cpuPercent, alertLevel(usage, 'cpu.'));
  $: memoryTone = pressureTone(memoryPercent, alertLevel(usage, 'memory.'));
  $: diskTone = pressureTone(diskPercent, alertLevel(usage, 'storage.'));
  $: summaryLabel = [
    `CPU ${percentLabel(cpuPercent)}`,
    `Memory ${percentLabel(memoryPercent)}`,
    `Disk ${percentLabel(diskPercent)}`
  ].join(' · ');

  onMount(() => startSystemUsagePolling());

  function cpuPressurePercent(value: SystemUsageResponse | null): number | null {
    const utilization = numberOrNull(value?.cpu?.utilization_percent);
    if (utilization !== null) return utilization;
    const load = numberOrNull(value?.cpu?.load_average?.one_minute);
    const cpus = numberOrNull(value?.cpu?.logical_cpus);
    if (load === null || cpus === null || cpus <= 0) return null;
    return Math.min(999, (load * 100) / cpus);
  }

  function diskPressurePercent(value: SystemUsageResponse | null): number | null {
    const filesystems = [
      value?.storage?.kvstore_directory,
      value?.storage?.raw_assets_default,
      value?.storage?.database?.storage?.filesystem
    ];
    const percents = filesystems
      .map((entry) => filesystemPressurePercent(entry))
      .filter((entry): entry is number => entry !== null);
    return percents.length ? Math.max(...percents) : null;
  }

  function filesystemPressurePercent(entry: SystemUsageFilesystem | undefined): number | null {
    if (!entry?.available) return null;
    const used = numberOrNull(entry.used_percent);
    if (used !== null) return used;
    const free = numberOrNull(entry.free_percent);
    return free === null ? null : 100 - free;
  }

  function alertLevel(value: SystemUsageResponse | null, prefix: string): 'warning' | 'critical' | null {
    const alerts = value?.stress?.alerts ?? [];
    const matching = alerts.filter((alert) => alert.metric?.startsWith(prefix));
    if (matching.some((alert) => alert.level === 'critical')) return 'critical';
    if (matching.some((alert) => alert.level === 'warning')) return 'warning';
    return null;
  }

  function pressureTone(percent: number | null, level: 'warning' | 'critical' | null): Tone {
    if (level === 'critical') return 'bad';
    if (level === 'warning') return 'warn';
    if (percent === null) return 'unknown';
    if (percent >= 95) return 'bad';
    if (percent >= 85) return 'warn';
    return 'good';
  }

  function percentLabel(value: number | null): string {
    return value === null ? 'unknown' : `${Math.round(value)}%`;
  }

  function numberOrNull(value: unknown): number | null {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
  }
</script>

<div class="system-pressure-indicator" title={summaryLabel} aria-label={`System resources: ${summaryLabel}`}>
  <span class={`pressure-segment tone-${cpuTone}`}>C</span>
  <span class={`pressure-segment tone-${memoryTone}`}>M</span>
  <span class={`pressure-segment tone-${diskTone}`}>D</span>
</div>
