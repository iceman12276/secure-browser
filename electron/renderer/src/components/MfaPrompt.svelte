<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';
  let code = $state('');
</script>

<form data-testid="mfa-prompt" onsubmit={(e) => { e.preventDefault(); vaultStore.verifyTotp(code); }}>
  <h2>Second factor</h2>
  <p>Enter your authenticator code</p>
  <input data-testid="totp-code" inputmode="numeric" bind:value={code} placeholder="123456" />
  <button data-testid="totp-verify">Verify</button>
</form>
