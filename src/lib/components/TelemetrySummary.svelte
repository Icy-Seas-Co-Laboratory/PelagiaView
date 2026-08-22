<script lang="ts">
  import type { TelemetryValue } from '$lib/api/types';

  export let telemetry: Record<string, TelemetryValue> | null | undefined = null;

  function formatValue(value: TelemetryValue): string {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return 'Unavailable';
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value.value);
  }

  $: entries = Object.entries(telemetry ?? {});
</script>

<section class="telemetry-summary" aria-labelledby="telemetry-summary-title">
  <div class="telemetry-summary-heading">
    <h3 id="telemetry-summary-title">Telemetry at frame time</h3>
    <span class="telemetry-count">{entries.length}</span>
  </div>
  {#if entries.length === 0}
    <p class="telemetry-empty">No telemetry values are available for this frame.</p>
  {:else}
    <dl>
      {#each entries as [key, value]}
        <div class="telemetry-value-row">
          <dt>{value.parameter || key}</dt>
          <dd>
            {#if value.missing_reason}
              <span class="telemetry-missing">{value.missing_reason}</span>
            {:else}
              {formatValue(value)}{value.unit ? ` ${value.unit}` : ''}
            {/if}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
</section>

<style>
  .telemetry-summary { border-top: 1px solid var(--border-subtle, #d9dee7); margin-top: 1rem; padding-top: 0.9rem; }
  .telemetry-summary-heading { align-items: center; display: flex; justify-content: space-between; gap: 0.5rem; }
  h3 { font-size: 0.78rem; letter-spacing: 0.04em; margin: 0; text-transform: uppercase; }
  .telemetry-count { color: var(--text-muted, #667085); font-size: 0.72rem; }
  .telemetry-empty { color: var(--text-muted, #667085); font-size: 0.78rem; line-height: 1.4; margin: 0.55rem 0 0; }
  dl { margin: 0.55rem 0 0; }
  .telemetry-value-row { align-items: baseline; display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.28rem 0; }
  dt { color: var(--text-muted, #667085); font-size: 0.76rem; overflow-wrap: anywhere; }
  dd { font-variant-numeric: tabular-nums; margin: 0; text-align: right; }
  .telemetry-missing { color: var(--text-muted, #667085); font-size: 0.74rem; }
</style>
