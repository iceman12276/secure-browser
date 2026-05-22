<script lang="ts">
  import { browser } from './lib/browserStore.svelte';
  import TabStrip from './components/TabStrip.svelte';
  import Toolbar from './components/Toolbar.svelte';

  browser.init();
</script>

<TabStrip />
<Toolbar />
<!-- Tab page content is rendered natively by WebContentsView below the chrome. -->
