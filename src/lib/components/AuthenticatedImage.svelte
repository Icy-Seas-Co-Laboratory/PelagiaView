<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { canvasToPngBlob, composeImage } from '$lib/utils/imageLoader';
  import type { AuthenticatedImageCache } from '$lib/utils/authenticatedImageCache';

  export let src = '';
  export let alt = '';
  export let imageClass = '';
  export let imageStyle = '';
  export let eager = false;
  export let invert = false;
  /** Optional owner that keeps blob URLs alive when this component is virtualized out of view. */
  export let cache: AuthenticatedImageCache | undefined = undefined;
  /** Distance around the nearest image scroll viewport that should begin loading. */
  export let preloadMargin = '1200px 800px';

  let element: HTMLImageElement;
  let objectUrl = '';
  let visible = false;
  let loadedKey = '';
  let sourceKey = '';
  let controller: AbortController | null = null;
  let observer: IntersectionObserver | null = null;
  let ownsObjectUrl = false;
  let destroyed = false;

  $: sourceKey = `${src}:${invert ? 'inverted' : 'normal'}`;
  $: if (visible && src && sourceKey !== loadedKey) void load(src, invert, sourceKey);

  async function load(source: string, inverted: boolean, key: string) {
    controller?.abort();
    loadedKey = key;
    try {
      let nextUrl: string;
      let nextUrlOwned = false;
      if (cache) {
        controller = null;
        nextUrl = await cache.load(key, (signal) => loadBlob(source, inverted, signal));
      } else {
        controller = new AbortController();
        const blob = await loadBlob(source, inverted, controller.signal);
        nextUrl = URL.createObjectURL(blob);
        nextUrlOwned = true;
      }
      if (destroyed || key !== sourceKey) {
        if (nextUrlOwned) URL.revokeObjectURL(nextUrl);
        return;
      }
      if (objectUrl && ownsObjectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = nextUrl;
      ownsObjectUrl = nextUrlOwned;
    } catch (error) {
      if (key === sourceKey && !(error instanceof Error && error.name === 'AbortError')) {
        if (objectUrl && ownsObjectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = '';
        ownsObjectUrl = false;
      }
    }
  }

  async function loadBlob(source: string, inverted: boolean, signal: AbortSignal): Promise<Blob> {
    if (inverted) {
      const composed = await composeImage({ imageUrl: source, invert: true, signal });
      return canvasToPngBlob(composed.canvas);
    }
    const response = await authenticatedFetch(source, { cache: 'no-store', signal });
    if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
    return response.blob();
  }

  onMount(() => {
    if (eager || typeof IntersectionObserver === 'undefined') {
      visible = true;
      return;
    }
    // ROI browsers scroll inside a bounded gallery rather than the document.
    // Observing that gallery directly makes rootMargin useful for prefetching;
    // a document-root observer remains available for images outside a gallery.
    const scrollRoot = element.closest<HTMLElement>('[data-image-scroll-root]');
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          observer?.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: preloadMargin }
    );
    observer.observe(element);
  });

  onDestroy(() => {
    destroyed = true;
    controller?.abort();
    observer?.disconnect();
    if (objectUrl && ownsObjectUrl) URL.revokeObjectURL(objectUrl);
  });
</script>

<img bind:this={element} class={imageClass} style={imageStyle} src={objectUrl || undefined} {alt} />
