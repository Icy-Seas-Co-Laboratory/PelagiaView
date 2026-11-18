<script lang="ts">
  export let label: string;
  export let minimum: number | null;
  export let maximum: number | null;
  export let low: number | null = null;
  export let high: number | null = null;
  export let step = 1;
  export let scale: 'linear' | 'sqrt' = 'linear';
  export let percent = false;
  export let suffix = '';
  export let onChange: () => void = () => {};

  $: minValue = minimum ?? 0;
  $: maxValue = maximum ?? 0;
  $: sliderMin = scale === 'sqrt' ? Math.sqrt(Math.max(0, minValue)) : minValue;
  $: sliderMax = scale === 'sqrt' ? Math.sqrt(Math.max(0, maxValue)) : maxValue;
  $: sliderStep = scale === 'sqrt' ? Math.max(0.01, (sliderMax - sliderMin) / 200) : step;
  $: displayedLow = low === null ? minValue : low;
  $: displayedHigh = high === null ? maxValue : high;
  $: sliderLow = scale === 'sqrt' ? Math.sqrt(Math.max(0, displayedLow)) : displayedLow;
  $: sliderHigh = scale === 'sqrt' ? Math.sqrt(Math.max(0, displayedHigh)) : displayedHigh;
  $: span = Math.max(sliderMax - sliderMin, Number.EPSILON);
  $: lowPercent = ((sliderLow - sliderMin) / span) * 100;
  $: highPercent = ((sliderHigh - sliderMin) / span) * 100;
  $: available = minimum !== null && maximum !== null && Number.isFinite(minimum) && Number.isFinite(maximum) && maximum >= minimum;

  function actual(value: number) { return scale === 'sqrt' ? Math.round(value * value) : value; }
  function clamp(value: number) { return Number.isFinite(value) ? Math.min(maxValue, Math.max(minValue, value)) : minValue; }
  function changeLow(value: string) { low = Math.min(clamp(actual(Number(value))), high ?? maxValue); onChange(); }
  function changeHigh(value: string) { high = Math.max(clamp(actual(Number(value))), low ?? minValue); onChange(); }
  function changeLowInput(value: string) { const next = clamp(Number(value) / (percent ? 100 : 1)); low = value === '' ? null : Math.min(next, high ?? maxValue); onChange(); }
  function changeHighInput(value: string) { const next = clamp(Number(value) / (percent ? 100 : 1)); high = value === '' ? null : Math.max(next, low ?? minValue); onChange(); }
  function reset() { low = null; high = null; onChange(); }
</script>

<div class="range-filter" class:unavailable={!available}>
  {#if !available}<span class="unavailable-note">No values available.</span>{:else}
  <div class="range-track" style={`--low:${lowPercent}%;--high:${highPercent}%`}>
    <input aria-label={`${label} minimum`} type="range" min={sliderMin} max={sliderMax} step={sliderStep} value={sliderLow} on:input={(event) => changeLow((event.currentTarget as HTMLInputElement).value)} />
    <input aria-label={`${label} maximum`} type="range" min={sliderMin} max={sliderMax} step={sliderStep} value={sliderHigh} on:input={(event) => changeHigh((event.currentTarget as HTMLInputElement).value)} />
  </div>
  <div class="range-values">
    <label>Minimum <input aria-label={`${label} minimum value`} type="number" min={minValue * (percent ? 100 : 1)} max={(high ?? maxValue) * (percent ? 100 : 1)} step={step * (percent ? 100 : 1)} value={low === null ? '' : low * (percent ? 100 : 1)} placeholder={String(minValue * (percent ? 100 : 1))} on:change={(event) => changeLowInput((event.currentTarget as HTMLInputElement).value)} />{suffix}</label>
    <label>Maximum <input aria-label={`${label} maximum value`} type="number" min={(low ?? minValue) * (percent ? 100 : 1)} max={maxValue * (percent ? 100 : 1)} step={step * (percent ? 100 : 1)} value={high === null ? '' : high * (percent ? 100 : 1)} placeholder={String(maxValue * (percent ? 100 : 1))} on:change={(event) => changeHighInput((event.currentTarget as HTMLInputElement).value)} />{suffix}</label>
  </div>
  <button class="reset" disabled={low === null && high === null} on:click={reset}>Reset</button>
  {/if}
</div>

<style>
  .range-filter { display:grid; grid-template-columns:1fr auto; gap:5px; }
  .range-track { grid-column:1 / -1; position:relative; height:22px; background:linear-gradient(to right,#b8c6cb 0 var(--low),var(--accent,#197997) var(--low) var(--high),#b8c6cb var(--high) 100%); background-size:100% 3px; background-position:center; background-repeat:no-repeat; }
  .range-track input { appearance:none; position:absolute; inset:0; width:100%; margin:0; pointer-events:none; background:transparent; }
  .range-track input:focus { z-index:1; }
  .range-track input:focus-visible::-webkit-slider-thumb { outline:2px solid var(--text,#17252b); outline-offset:2px; }
  .range-track input:focus-visible::-moz-range-thumb { outline:2px solid var(--text,#17252b); outline-offset:2px; }
  .range-track input::-webkit-slider-thumb { appearance:none; width:14px; height:14px; border:2px solid var(--accent,#197997); border-radius:50%; background:#fff; pointer-events:auto; cursor:grab; }
  .range-track input::-moz-range-thumb { width:11px; height:11px; border:2px solid var(--accent,#197997); border-radius:50%; background:#fff; pointer-events:auto; cursor:grab; }
  .range-values { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .range-values label { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:3px; font-size:9px; }
  .range-values input { width:100%; min-width:0; padding:4px; }
  .reset { align-self:end; padding:4px 6px; font-size:9px; }
  .unavailable-note { color:var(--muted,#61757d); font-size:10px; }
</style>
