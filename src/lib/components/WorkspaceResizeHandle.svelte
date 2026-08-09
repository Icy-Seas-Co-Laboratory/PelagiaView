<script lang="ts">
  import { onDestroy } from 'svelte';

  export let label: string;
  export let value: number;
  export let min = 180;
  export let max = 520;
  export let direction: 1 | -1 = 1;
  export let position: 'left' | 'right' = 'left';
  export let onResize: ((value: number) => void) | null = null;

  let dragging = false;
  let lastX = 0;
  let dragValue = value;

  function startDrag(event: PointerEvent) {
    dragging = true;
    lastX = event.clientX;
    dragValue = value;
    window.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', stopDrag, { once: true });
    event.preventDefault();
  }

  function drag(event: PointerEvent) {
    if (!dragging) return;
    const delta = (event.clientX - lastX) * direction;
    lastX = event.clientX;
    dragValue += delta;
    resizeTo(dragValue);
  }

  function stopDrag() {
    dragging = false;
    window.removeEventListener('pointermove', drag);
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const delta = (event.key === 'ArrowRight' ? 16 : -16) * direction;
    resizeTo(value + delta);
    event.preventDefault();
  }

  function resizeTo(next: number) {
    onResize?.(Math.min(max, Math.max(min, Math.round(next))));
  }

  onDestroy(stopDrag);
</script>

<!-- An adjustable ARIA separator is intentionally focusable and interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<div
  class="workspace-resize-handle"
  class:dragging
  class:resize-handle-right={position === 'right'}
  role="separator"
  aria-label={label}
  aria-orientation="vertical"
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={Math.round(value)}
  tabindex="0"
  on:pointerdown={startDrag}
  on:keydown={keydown}
></div>
