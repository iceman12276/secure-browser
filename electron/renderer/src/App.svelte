<script lang="ts">
  let version = $state('loading…');

  async function load() {
    version = await window.secureBrowser.coreVersion();
  }
  void load();
</script>

<main>
  <h1>Secure Browser</h1>
  <p data-testid="core-version">{version}</p>
</main>

<style>
  main { font-family: system-ui, sans-serif; padding: 2rem; }
</style>
