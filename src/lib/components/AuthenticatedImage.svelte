<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { authenticatedFetch } from '$lib/api/client';
  import { canvasToPngBlob, composeImage } from '$lib/utils/imageLoader';

  export let src = '';
  export let alt = '';
  export let imageClass = '';
  export let eager = false;
  export let invert = false;
  /** Distance around the nearest image scroll viewport that should begin loading. */
  export let preloadMargin = '1200px 800px';

  let element: HTMLImageElement;
  let objectUrl = '';
  let visible = false;
  let loadedKey = '';
  let sourceKey = '';
  let controller: AbortController | null = null;
  let observer: IntersectionObserver | null = null;

  $: sourceKey = `${src}:${invert ? 'inverted' : 'normal'}`;
  $: if (visible && src && sourceKey !== loadedKey) void load(src, invert, sourceKey);

  async function load(source: string, inverted: boolean, key: string) {
    controller?.abort();
    controller = new AbortController();
    loadedKey = key;
    try {
      let blob: Blob;
      if (inverted) {
        const composed = await composeImage({
          imageUrl: source,
          invert: true,
          signal: controller.signal
        });
        blob = await canvasToPngBlob(composed.canvas);
      } else {
        const response = await authenticatedFetch(source, {
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
        blob = await response.blob();
      }
      const nextUrl = URL.createObjectURL(blob);
      if (key !== sourceKey) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = nextUrl;
    } catch (error) {
      if (key === sourceKey && !(error instanceof DOMException && error.name === 'AbortError')) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
    }
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
    controller?.abort();
    observer?.disconnect();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
</script>

<img bind:this={element} class={imageClass} src={objectUrl || undefined} {alt} />
