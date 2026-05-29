<script lang="ts">
  import { browser } from './lib/browserStore.svelte';
  import TabStrip from './components/TabStrip.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import VaultSidebar from './components/VaultSidebar.svelte';
  import SavePrompt from './components/SavePrompt.svelte';

  browser.init();
</script>

<TabStrip />
<Toolbar />
<VaultSidebar />
<SavePrompt />
<!-- Tab page content is rendered natively by WebContentsView below the chrome. -->

<style>
  :global(body) { margin: 0; }
</style>
