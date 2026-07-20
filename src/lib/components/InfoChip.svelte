<script lang="ts">
  import { onDestroy, tick } from 'svelte';

  export let text: string;
  export let label = 'Help';

  let button: HTMLButtonElement;
  let tooltip: HTMLDivElement;
  let open = false;
  let tooltipStyle = '';
  let placement: 'top' | 'bottom' = 'bottom';

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  async function showTooltip() {
    open = true;
    await tick();
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
  }

  function hideTooltip() {
    open = false;
    window.removeEventListener('resize', positionTooltip);
    window.removeEventListener('scroll', positionTooltip, true);
  }

  function positionTooltip() {
    if (!button || !tooltip || typeof window === 'undefined') return;
    const margin = 10;
    const gap = 8;
    const anchor = button.getBoundingClientRect();
    const bubble = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = anchor.bottom + gap;
    placement = 'bottom';
    if (top + bubble.height + margin > viewportHeight && anchor.top - bubble.height - gap > margin) {
      top = anchor.top - bubble.height - gap;
      placement = 'top';
    }

    const halfWidth = bubble.width / 2;
    const minLeft = margin + halfWidth;
    const maxLeft = Math.max(minLeft, viewportWidth - margin - halfWidth);
    const left = clamp(anchor.left + anchor.width / 2, minLeft, maxLeft);

    tooltipStyle = `left: ${left}px; top: ${top}px;`;
  }

  onDestroy(hideTooltip);
</script>

<button
  bind:this={button}
  type="button"
  class="field-help-icon info-chip"
  aria-label={label}
  on:click|preventDefault
  on:mouseenter={showTooltip}
  on:mouseleave={hideTooltip}
  on:focus={showTooltip}
  on:blur={hideTooltip}
>
  i
</button>

{#if open}
  <div
    bind:this={tooltip}
    class="floating-field-tooltip floating-field-tooltip-{placement}"
    style={tooltipStyle}
    role="tooltip"
  >
    {text}
  </div>
{/if}
