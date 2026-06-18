<script lang="ts">
  import { imageInversionEnabled } from '$lib/stores/displayPreferences';
</script>

<label class="header-invert-toggle">
  <span>Invert</span>
  <input type="checkbox" bind:checked={$imageInversionEnabled} />
  <span class="switch-track" aria-hidden="true"></span>
</label>
