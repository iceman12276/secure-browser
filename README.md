# Secure Browser

A local-first web browser with an embedded, zero-knowledge password manager.
The UI follows the **Citadel · Aurora** design (cool slate, electric blue, minimal density).

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
```bash
npm install
npm run build:core   # build the Rust addon
npm run dev          # run the app
npm test             # cargo test + playwright
```
