<script lang="ts">
  import { connectSession, session } from '$lib/stores/session';

  let endpoint = $session.baseUrl;
  let localError: string | null = null;

  async function connect() {
    localError = null;
    try {
      await connectSession(endpoint);
    } catch (error) {
      localError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<main class="landing">
  <section class="landing-panel">
    <div class="brand-lockup">
      <img class="brand-logo" src="/brand/pelagia_logo.png" alt="Pelagia" />
      <div>
        <p class="eyebrow">PelagiaView</p>
        <h1>Connect to a Pelagia server</h1>
      </div>
    </div>

    <form class="connect-form" on:submit|preventDefault={connect}>
      <label for="endpoint">Server endpoint</label>
      <div class="endpoint-row">
        <input
          id="endpoint"
          bind:value={endpoint}
          inputmode="url"
          autocomplete="url"
          placeholder="http://127.0.0.1:8000"
        />
        <button type="submit" disabled={$session.connecting}>
          {$session.connecting ? 'Connecting' : 'Connect'}
        </button>
      </div>
      {#if localError ?? $session.error}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}
    </form>

    <div class="endpoint-notes">
      <p>PelagiaView keeps the active endpoint in browser storage and caches short-lived API reads during the session.</p>
      <p>The dashboard uses the current Pelagia HTTP API and marks planned live endpoints where the backend is still TBD.</p>
    </div>
  </section>
</main>
