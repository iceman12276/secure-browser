<script lang="ts">
  import { browser } from './lib/browserStore.svelte';
  import TabStrip from './components/TabStrip.svelte';
  import Toolbar from './components/Toolbar.svelte';
  import VaultSidebar from './components/VaultSidebar.svelte';
  import SavePrompt from './components/SavePrompt.svelte';

  browser.init();
</script>

<h1 class="sr-only">Secure Browser</h1>
<TabStrip />
<Toolbar />
<VaultSidebar />
<SavePrompt />
<!-- Tab page content is rendered natively by WebContentsView below the chrome. -->
