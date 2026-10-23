<script lang="ts">
  /** A deliberate page-level wait state for requests whose result replaces visible work. */
  export let label = 'Loading…';
</script>

<div class="loading-overlay" role="status" aria-live="polite" aria-label={label}>
  <div class="loading-overlay-card">
    <span class="loading-overlay-spinner" aria-hidden="true"></span>
    <span>{label}</span>
  </div>
</div>

<style>
  .loading-overlay {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--app-bg, #f7f8f8) 62%, transparent);
    cursor: progress;
  }

  .loading-overlay-card {
    display: inline-flex;
    gap: 0.7rem;
    align-items: center;
    max-width: min(28rem, 100%);
    padding: 0.85rem 1rem;
    border: 1px solid var(--app-border, #c9d1ce);
    border-radius: 0.6rem;
    color: var(--app-text, #18201d);
    background: var(--app-surface, #fff);
    box-shadow: 0 0.75rem 2.25rem rgba(16, 28, 22, 0.18);
    font-weight: 650;
  }

  .loading-overlay-spinner {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    border: 2px solid var(--app-border, #c9d1ce);
    border-top-color: var(--app-accent, #237a57);
    border-radius: 50%;
    animation: loading-overlay-spin 0.8s linear infinite;
  }

  @keyframes loading-overlay-spin { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .loading-overlay-spinner { animation: none; border-top-color: var(--app-border, #c9d1ce); }
  }
</style>
