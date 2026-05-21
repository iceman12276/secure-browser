# Task 0 — Repo + Scaffold + napi Bridge + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the secure-browser monorepo — an Electron + TypeScript + Svelte shell with an in-process Rust vault core (napi-rs) — and prove the JS↔Rust bridge works end-to-end with a CI baseline.

**Architecture:** One git repo. The Electron app lives at the repo root and is built by electron-vite v5 (`svelte-ts`), with its source under `electron/{main,preload,renderer,content}`. The Rust native addon lives in `core/`, is built by `@napi-rs/cli` into `core/index.js` + `core/index.d.ts` + a platform `.node` file, and is consumed by the Electron **main process only** as a local `file:./core` dependency (electron-vite v5 auto-externalizes dependencies, so the `.node` is never bundled). The renderer is sandboxed and reaches the main process via a context-isolated preload bridge.

**Tech Stack:** Electron, TypeScript, Svelte, electron-vite v5, electron-builder, @napi-rs/cli (`napi` 2.x runtime), Rust (cargo 1.94.1), Playwright `_electron` for integration tests, GitHub Actions for CI.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Root Electron app manifest; scripts for dev/build/test; declares `secure-browser-core` as `file:./core` dependency. |
| `electron.vite.config.ts` | electron-vite config pointing main/preload/renderer at `electron/` paths; Svelte plugin in renderer. |
| `tsconfig.json`, `tsconfig.node.json` | TypeScript config (renderer DOM lib vs node lib split). |
| `electron/main/index.ts` | Main process entry: create the BrowserWindow, load renderer, wire one smoke-test IPC handler that calls the Rust core. |
| `electron/preload/index.ts` | Context-isolated `contextBridge` exposing a minimal `window.secureBrowser` API. |
| `electron/renderer/index.html` | Renderer HTML entry. |
| `electron/renderer/src/main.ts` | Svelte app bootstrap. |
| `electron/renderer/src/App.svelte` | Trivial UI that calls the bridge and shows the Rust result (smoke test surface). |
| `electron/renderer/src/env.d.ts` | Ambient types for `window.secureBrowser`. |
| `core/Cargo.toml` | Rust crate manifest: `crate-type = ["cdylib"]`, napi deps. |
| `core/build.rs` | `napi_build::setup()`. |
| `core/src/lib.rs` | The Rust addon: one `#[napi]` function (`core_version`) for the bridge smoke test. |
| `core/package.json` | napi package manifest (`napi.name = "secure-browser-core"`, build script). |
| `core/.cargo/config.toml`, `core/rustfmt.toml` | napi scaffold support files. |
| `tests/bridge.spec.ts` | Playwright `_electron` test: app opens, renderer is sandboxed, Rust core value crosses the bridge. |
| `playwright.config.ts` | Playwright test config (serial, no browser projects). |
| `.gitignore` | Ignore `node_modules`, `out`, `dist`, Rust `target`, build artifacts. |
| `README.md` | Project goals + architecture summary. |
| `LICENSE` | MIT license. |
| `.github/workflows/ci.yml` | CI: build Rust core, build app, run `cargo test` + Playwright tests. |

---

## Task 0.1: Initialize git repo and GitHub remote

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Confirm we are in the repo and it has the spec committed**

Run: `cd ~/Desktop/dev/secure-browser && git log --oneline -1`
Expected: shows the commit `docs: add secure-browser design spec` (repo already initialized).

- [ ] **Step 2: Write `.gitignore`**

Create `.gitignore`:

```gitignore
# Node
node_modules/
out/
dist/
*.log
.DS_Store

# electron-vite / vite
.vite/

# Rust
core/target/
target/

# napi build artifacts
core/*.node
core/index.js
core/index.d.ts

# Playwright
test-results/
playwright-report/
.cache/
```

- [ ] **Step 3: Write `LICENSE` (MIT)**

Create `LICENSE`:

```text
MIT License

Copyright (c) 2026 Isaac Quintero

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Write `README.md`**

Create `README.md`:

```markdown
# Secure Browser

A local-first web browser with an embedded, zero-knowledge password manager.

## Goals
- **Learning** first; **personal daily use** (single user) second.
- Own the browser so autofill actually works end-to-end.
- Local-first: no server, no cloud, encrypted SQLite on disk.

## Architecture
- **Electron + TypeScript + Svelte** — the browser shell (tabs, address bar, vault UI).
- **Rust vault core** (`core/`, via napi-rs) — Argon2id KDF, ML-KEM-768 + AES-256-GCM
  hybrid encryption, TOTP, WebAuthn RP logic. Runs in-process in the Electron **main**
  process. Vault plaintext never leaves the main process.
- **Local encrypted SQLite** (SQLCipher) — stores ciphertext only.

Tab renderers are sandboxed (`sandbox: true`, `contextIsolation: true`,
`nodeIntegration: false`) and reach the core only through an allow-listed IPC bridge.

## Status
Bootstrapping (Task 0). See `docs/superpowers/plans/` for the milestone plans.

## Develop
\`\`\`bash
npm install
npm run build:core   # build the Rust addon
npm run dev          # run the app
npm test             # cargo test + playwright
\`\`\`
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md LICENSE
git commit -m "chore: add gitignore, README, and license"
```

- [ ] **Step 6: Create the GitHub repo and push**

Run:
```bash
gh repo create secure-browser --private --source=. --remote=origin --description "Local-first browser with an embedded zero-knowledge password manager"
git push -u origin main
```
Expected: repo created under the authenticated account (`iceman12276`); `main` pushed.

---

## Task 0.2: Scaffold the Rust napi-rs core with a bridge smoke function

**Files:**
- Create: `core/Cargo.toml`
- Create: `core/build.rs`
- Create: `core/src/lib.rs`
- Create: `core/package.json`
- Create: `core/.cargo/config.toml`
- Create: `core/rustfmt.toml`

> Note: We hand-author the napi crate (rather than running interactive `napi new`) so the layout is deterministic and matches the spec's `core/` location. `@napi-rs/cli` is still used as the build tool.

- [ ] **Step 1: Write `core/Cargo.toml`**

Create `core/Cargo.toml`:

```toml
[package]
name = "secure-browser-core"
version = "0.0.0"
edition = "2021"
license = "MIT"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", default-features = false, features = ["napi4"] }
napi-derive = "2"

[build-dependencies]
napi-build = "2"

[profile.release]
lto = true
```

- [ ] **Step 2: Write `core/build.rs`**

Create `core/build.rs`:

```rust
fn main() {
    napi_build::setup();
}
```

- [ ] **Step 3: Write the failing Rust unit test + smoke function**

Create `core/src/lib.rs`:

```rust
#![deny(clippy::all)]

use napi_derive::napi;

/// Smoke-test function proving the JS<->Rust bridge works.
/// Returns a stable identifier string the Electron main process can assert on.
#[napi]
pub fn core_version() -> String {
    format!("secure-browser-core {}", env!("CARGO_PKG_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_version_reports_crate_version() {
        let v = core_version();
        assert!(v.starts_with("secure-browser-core "));
        assert!(v.contains(env!("CARGO_PKG_VERSION")));
    }
}
```

- [ ] **Step 4: Run the Rust test to verify it passes**

Run: `cd core && cargo test`
Expected: PASS — `core_version_reports_crate_version ... ok`.

- [ ] **Step 5: Write `core/package.json`**

Create `core/package.json`:

```json
{
  "name": "secure-browser-core",
  "version": "0.0.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "secure-browser-core"
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform"
  },
  "devDependencies": {
    "@napi-rs/cli": "^2"
  }
}
```

- [ ] **Step 6: Write `core/.cargo/config.toml`**

Create `core/.cargo/config.toml`:

```toml
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "target-feature=+crt-static"]
```

> Note: This static-CRT flag matches napi-rs Linux defaults. If `napi build` fails to link on this machine, delete this file and rebuild — it is non-essential for a single-machine dev setup.

- [ ] **Step 7: Write `core/rustfmt.toml`**

Create `core/rustfmt.toml`:

```toml
edition = "2021"
```

- [ ] **Step 8: Build the addon and verify artifacts**

Run:
```bash
cd core && npm install && npm run build
ls *.node index.js index.d.ts
```
Expected: produces `secure-browser-core.<platform>.node`, `index.js`, and `index.d.ts`. The `index.d.ts` should contain `export declare function coreVersion(): string` (napi auto-converts `core_version` → `coreVersion`).

- [ ] **Step 9: Smoke-test the addon directly from Node**

Run: `cd core && node -e "console.log(require('./index.js').coreVersion())"`
Expected: prints `secure-browser-core 0.0.0`.

- [ ] **Step 10: Commit**

```bash
cd ~/Desktop/dev/secure-browser
git add core/Cargo.toml core/build.rs core/src/lib.rs core/package.json core/.cargo/config.toml core/rustfmt.toml
git commit -m "feat(core): scaffold napi-rs Rust addon with coreVersion bridge smoke test"
```

---

## Task 0.3: Scaffold the Electron + Svelte app pointed at `electron/`

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `electron/main/index.ts`
- Create: `electron/preload/index.ts`
- Create: `electron/renderer/index.html`
- Create: `electron/renderer/src/main.ts`
- Create: `electron/renderer/src/App.svelte`
- Create: `electron/renderer/src/env.d.ts`

- [ ] **Step 1: Write the root `package.json`**

Create `package.json`:

```json
{
  "name": "secure-browser",
  "version": "0.0.0",
  "description": "Local-first browser with an embedded zero-knowledge password manager",
  "license": "MIT",
  "main": "out/main/index.js",
  "scripts": {
    "build:core": "npm --prefix core run build",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test:e2e": "playwright test",
    "test": "npm run build:core && cd core && cargo test && cd .. && npm run build && playwright test"
  },
  "dependencies": {
    "secure-browser-core": "file:./core"
  },
  "devDependencies": {
    "@playwright/test": "^1",
    "@sveltejs/vite-plugin-svelte": "^4",
    "electron": "^33",
    "electron-vite": "^5",
    "svelte": "^5",
    "svelte-check": "^4",
    "typescript": "^5"
  }
}
```

> Version note: pin `electron-vite` to `^5` (the version this plan targets — `externalizeDeps` is on by default, so the `file:./core` dependency is auto-externalized). If `npm install` resolves an older major, see Task 0.4 Step 3 for the v2–v4 fallback config.

- [ ] **Step 2: Write `tsconfig.node.json` (main + preload)**

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["electron/main/**/*.ts", "electron/preload/**/*.ts", "electron.vite.config.ts"]
}
```

- [ ] **Step 3: Write `tsconfig.json` (renderer)**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["electron/renderer/**/*.ts", "electron/renderer/**/*.svelte"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Write `electron/renderer/src/env.d.ts` (bridge types)**

Create `electron/renderer/src/env.d.ts`:

```typescript
/// <reference types="svelte" />

export interface SecureBrowserApi {
  /** Returns the Rust core version string, proving the bridge works. */
  coreVersion: () => Promise<string>;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
```

- [ ] **Step 5: Write `electron/preload/index.ts`**

Create `electron/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Minimal, allow-listed bridge. Only named channels are reachable.
const api = {
  coreVersion: (): Promise<string> => ipcRenderer.invoke('core:version'),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('secureBrowser', api);
} else {
  // contextIsolation must be ON; fail loudly if a misconfigured window loads us.
  throw new Error('contextIsolation is disabled — refusing to expose bridge insecurely');
}
```

- [ ] **Step 6: Write `electron/main/index.ts`**

Create `electron/main/index.ts`:

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { coreVersion } from 'secure-browser-core';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    // dev: electron-vite serves the renderer
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Single IPC handler: bridge smoke test. Returns the Rust core version.
ipcMain.handle('core:version', () => coreVersion());

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Write `electron/renderer/src/App.svelte`**

Create `electron/renderer/src/App.svelte`:

```svelte
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
```

- [ ] **Step 8: Write `electron/renderer/src/main.ts`**

Create `electron/renderer/src/main.ts`:

```typescript
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
```

- [ ] **Step 9: Write `electron/renderer/index.html`**

Create `electron/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>Secure Browser</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

---

## Task 0.4: Wire electron-vite config and verify the app builds and runs

**Files:**
- Create: `electron.vite.config.ts`

- [ ] **Step 1: Write `electron.vite.config.ts`**

Create `electron.vite.config.ts`:

```typescript
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
        // Native addon must stay external. v5 also auto-externalizes deps,
        // but we list it explicitly so this is correct on v2–v5.
        external: ['secure-browser-core'],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: 'electron/renderer',
    plugins: [svelte()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/renderer/index.html') },
      },
    },
  },
});
```

- [ ] **Step 2: Install dependencies**

Run: `cd ~/Desktop/dev/secure-browser && npm install`
Expected: installs Electron, electron-vite, Svelte, Playwright; links `secure-browser-core` from `./core`.

- [ ] **Step 3: (Fallback only) If electron-vite resolved to v2–v4**

Run: `npm ls electron-vite`
If the major is **< 5**, edit `electron.vite.config.ts` to use the plugin form for externalization:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main', rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload', rollupOptions: { input: { index: resolve(__dirname, 'electron/preload/index.ts') } } },
  },
  renderer: {
    root: 'electron/renderer',
    plugins: [svelte()],
    build: { outDir: 'out/renderer', rollupOptions: { input: { index: resolve(__dirname, 'electron/renderer/index.html') } } },
  },
});
```
If it resolved to v5, skip this step.

- [ ] **Step 4: Build the Rust core (prerequisite for the app build)**

Run: `npm run build:core`
Expected: `core/index.js`, `core/index.d.ts`, and `core/*.node` exist.

- [ ] **Step 5: Build the app and verify it compiles**

Run: `npm run build`
Expected: produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` with no errors. The main bundle must NOT inline the `.node` file (it imports `secure-browser-core` as an external).

- [ ] **Step 6: Commit**

```bash
git add package.json electron.vite.config.ts tsconfig.json tsconfig.node.json electron/
git commit -m "feat: scaffold Electron + Svelte shell with sandboxed renderer and core bridge"
```

---

## Task 0.5: Playwright bridge + sandbox integration test

**Files:**
- Create: `playwright.config.ts`
- Test: `tests/bridge.spec.ts`

- [ ] **Step 1: Write `playwright.config.ts`**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/bridge.spec.ts`:

```typescript
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  // Launch the built app from the project root (uses package.json "main").
  electronApp = await electron.launch({ args: ['.'], cwd: join(__dirname, '..') });
  window = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
});

test('app window opens with the expected title', async () => {
  await expect(window).toHaveTitle('Secure Browser');
});

test('Rust core value crosses the bridge into the renderer', async () => {
  const text = await window.getByTestId('core-version').textContent();
  expect(text).toMatch(/^secure-browser-core \d+\.\d+\.\d+$/);
});

test('renderer is sandboxed: no Node access', async () => {
  const exposure = await window.evaluate(() => ({
    typeofRequire: typeof (globalThis as { require?: unknown }).require,
    typeofProcess: typeof (globalThis as { process?: unknown }).process,
    typeofModule: typeof (globalThis as { module?: unknown }).module,
    hasBridge: typeof window.secureBrowser,
  }));
  expect(exposure.typeofRequire).toBe('undefined');
  expect(exposure.typeofProcess).toBe('undefined');
  expect(exposure.typeofModule).toBe('undefined');
  expect(exposure.hasBridge).toBe('object');
});

test('webPreferences are locked down', async () => {
  const wp = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return (win.webContents as unknown as {
      getLastWebPreferences?: () => { nodeIntegration?: boolean; sandbox?: boolean; contextIsolation?: boolean };
    }).getLastWebPreferences?.() ?? null;
  });
  expect(wp?.nodeIntegration).toBeFalsy();
  expect(wp?.sandbox).toBe(true);
  expect(wp?.contextIsolation).toBe(true);
});
```

- [ ] **Step 3: Install Playwright browsers/deps (first run only)**

Run: `npx playwright install`
Expected: completes (Electron tests use the bundled Electron, but this also pulls Playwright runtime deps).

- [ ] **Step 4: Run the test to verify it passes (build first)**

Run: `npm run build:core && npm run build && npx playwright test`
Expected: all four tests PASS — title, bridge value, sandbox isolation, locked-down webPreferences.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/bridge.spec.ts
git commit -m "test: add Playwright bridge + renderer-sandbox integration test"
```

---

## Task 0.6: CI baseline (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - name: Install dependencies
        run: npm install

      - name: Build Rust core
        run: npm run build:core

      - name: cargo test
        run: cargo test --manifest-path core/Cargo.toml

      - name: Build app
        run: npm run build

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run integration tests (headless via xvfb)
        run: xvfb-run --auto-servernum npx playwright test
```

> Note: Electron needs a display on Linux CI; `xvfb-run` provides a virtual one. `--with-deps` installs the OS libraries Electron/Chromium require.

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build Rust core, build app, run cargo + Playwright tests"
git push
```

- [ ] **Step 3: Verify CI passes**

Run: `gh run watch`
Expected: the workflow run completes green. If the `crt-static` flag in `core/.cargo/config.toml` breaks the Linux CI link step, remove that file (see Task 0.2 Step 6 note), commit, and push again.

---

## Self-Review

**Spec coverage (Task 0 requirements):**
- `git init` + GitHub repo + push → Task 0.1 (repo pre-initialized; remote created Step 6).
- Scaffold Electron+TS app → Tasks 0.3, 0.4.
- Scaffold napi-rs Rust crate loaded into main, returning a value across the boundary → Task 0.2 (`core_version`) + Task 0.4 (imported in main) + Task 0.5 (asserted across the bridge).
- `.gitignore`, README, license, initial commit → Task 0.1.
- **Verify:** `npm run build` succeeds (0.4 Step 5); Electron opens a window (0.5); a trivial Rust core function callable from main and asserted in a test (0.5 Step 4). ✓ All covered.

**Placeholder scan:** No TBD/TODO/"handle errors" placeholders; every code step contains complete content and every command states expected output.

**Type consistency:** Bridge method is `coreVersion` everywhere (preload `api.coreVersion`, `env.d.ts` `SecureBrowserApi.coreVersion`, App.svelte `window.secureBrowser.coreVersion`, test `secureBrowser`). Rust `core_version` → JS `coreVersion` (napi camelCase conversion, noted in 0.2 Step 8). IPC channel `'core:version'` matches between preload (`ipcRenderer.invoke('core:version')`) and main (`ipcMain.handle('core:version', …)`). Package name `secure-browser-core` matches across `core/Cargo.toml`, `core/package.json` `napi.name`, root `package.json` dependency, the main-process import, and the rollup `external`. Build outputs (`out/main/index.js` etc.) match `package.json` `"main"` and the renderer `loadFile` path.

---

## Execution Handoff

Plan complete. After this, proceed to `2026-05-20-m1-browser-shell.md`.
