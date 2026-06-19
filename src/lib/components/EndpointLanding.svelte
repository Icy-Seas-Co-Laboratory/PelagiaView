<script lang="ts">
  import { connectSession, session } from '$lib/stores/session';

  let endpoint = $session.baseUrl;
  let username = '';
  let password = '';
  let projectKey = '';
  let localError: string | null = null;

  async function connect() {
    localError = null;
    try {
      await connectSession({
        baseUrl: endpoint,
        username,
        password,
        projectKey
      });
      password = '';
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
      <div class="credential-grid">
        <label>
          <span>Username</span>
          <input bind:value={username} autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input bind:value={password} type="password" autocomplete="current-password" required />
        </label>
        <label>
          <span>Project key</span>
          <input bind:value={projectKey} autocomplete="off" placeholder="optional" />
        </label>
      </div>
      {#if localError ?? $session.error}
        <p class="form-error">{localError ?? $session.error}</p>
      {/if}
    </form>

    <div class="endpoint-notes">
      <p>PelagiaView keeps the active endpoint and session token in browser storage. Passwords stay out of local storage.</p>
      <p>Project membership controls the datasets, frames, and generated resources available to the dashboard.</p>
    </div>
  </section>
</main>
