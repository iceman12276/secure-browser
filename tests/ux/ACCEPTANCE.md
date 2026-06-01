# Final UX Acceptance — Secure Browser

**Verdict: PASS** — a non-technical first-timer completes the entire journey unaided,
with felt feedback at every step, no dead ends, no raw errors, and no exposed secrets.
One real felt-UX defect was found *during* this pass (unstyled MFA controls), fixed,
and re-verified — see [Finding & fix](#finding--fix).

This is not a "green CI" rubber stamp. The built app was driven end-to-end on a real
display, and **every screen was looked at**, not just asserted.

| | |
|---|---|
| **What was driven** | The **built** artifact (`out/` + native Rust core `*.node`), launched via Playwright `_electron` — the real app, not a unit harness. |
| **Base commit** | `5f0fd79` (M4 + native FIDO2, WebAuthn, Electron 42 follow-ups all merged) |
| **Display** | Rendered on a real X display (`DISPLAY=:0`) — screenshots are of the actual rendered UI. |
| **Second factor** | TOTP (automatable). The **security-key / CTAP2** path needs a physical touch and is validated manually — see [Scope & limits](#scope--limits). |
| **Harness** | [`acceptance.spec.ts`](./acceptance.spec.ts) (journey) + [`connectivity.spec.ts`](./connectivity.spec.ts) (real-internet check) |
| **Screenshots** | [`screenshots/`](./screenshots/) — one per step |

## Reproduce

```bash
npm install
npm run build:core        # native Rust napi core → core/*.node
npm run build             # electron-vite → out/
npx playwright test tests/ux/acceptance.spec.ts      # the journey + per-step PASS/FAIL
npx playwright test tests/ux/connectivity.spec.ts    # loads live example.com + wikipedia.org
```

A machine-readable run record is written to `tests/ux/results.json` (gitignored — transient per run).

## The journey — every step a first-timer takes

| # | What the user does | Verdict | Evidence | What I saw |
|---|---|:--:|---|---|
| 1 | Opens the app for the first time | ✅ PASS | `01-create-vault.png` | Clear **"Create vault"** heading, one password field, one **Create** button. No jargon, no blank screen. |
| 2 | Types a master password, presses **Enter** | ✅ PASS | `02-vault-unlocked.png` | Vault opens in **118 ms** (Argon2 KDF). Keyboard-only worked (type + Enter). Under 1 s, so the lack of a spinner is *not* felt. |
| 3 | Sets up 2FA (authenticator app) | ✅ PASS | `03-totp-qr.png`, `04-mfa-enrolled.png` | QR renders as a real inline PNG (the TOTP-QR CSP bug stays fixed — scannable by a phone). After confirming, an explicit **"✅ A second factor is enrolled."** appears. |
| 4 | Adds a credential | ✅ PASS | `05-credential-added.png` | Stored entry shows label + username only; the password is **hidden behind a Reveal button** — never shown by default. |
| 5 | Reveals the password | ✅ PASS | `06-revealed.png` | Plaintext appears **only after an explicit click**, in a monospace accent box. |
| 6 | Locks the vault | ✅ PASS | `07-locked.png` | List + any revealed secret disappear; back to **Unlock**. No way to read secrets while locked. |
| 7 | Re-enters master password | ✅ PASS | `08-mfa-prompt.png` | **89 ms** to the second-factor gate. Password alone does **not** open the vault — TOTP is still required. (TOTP-only vault correctly hides the security-key button — no "no credentials" dead end.) |
| 8 | Fat-fingers the 2FA code | ✅ PASS | `09-wrong-code.png` | Stays locked; shows **"Invalid authentication code"** — human-readable, no stack trace, no `[object Object]`. |
| 9 | Enters the correct 2FA code | ✅ PASS | `10-unlocked-again.png` | Vault opens; the stored credential is back. Full **pw + TOTP** unlock works end-to-end. |
| 10 | Visits a saved site → autofill | ✅ PASS | `11-autofill-overlay.png`, `12-autofilled.png` | An overlay (`octocat — My demo login`) offers on the matching origin. Password stays **empty until the user clicks** the candidate; then both fields fill in **one gesture**. |
| 11 | Visits an unknown site | ✅ PASS | — | **No overlay, nothing pre-filled.** Credentials don't leak across origins. |
| 12 | Logs into a new site | ✅ PASS | `13-save-prompt.png` | A themed **"Save password for newuser?"** prompt (Save / Not now); accepting adds it to the vault (count 1→2). |
| 13 | (Trust boundary probe) | ✅ PASS | — | Inside a web page: `secureBrowser`, `require`, `module`, `process` are **all `undefined`**. The vault API is confined to the chrome UI — a page cannot touch it. |
| 14 | Re-locks | ✅ PASS | `14-relocked.png` | Returns to the unlock gate, list cleared — the journey closes where it began. |
| 15 | (Keyboard a11y probe) | ✅ PASS | `15-focus-visible.png` | Tab from the password field moves focus to the Unlock button with a **visible focus ring**. |

## Felt-UX measurements (verified, not assumed)

The biggest felt-UX risk going in was the Argon2 key-derivation wait on create/unlock —
the same *class* of problem as the 60 s unlock bug. So I **measured** it instead of guessing:

| Operation | Measured | Has a spinner? | Felt? |
|---|--:|:--:|---|
| Create vault (Argon2) | **118 ms** | No | No — instant. A spinner would never even render. |
| Unlock → 2FA gate | **89 ms** | No | No — instant. |
| Security-key ceremony | (hardware) | **Yes** — animated spinner + "touch it when it blinks" | n/a here; manual |

Conclusion: the absence of a loading spinner on Create/Unlock is **not** a defect — both
operations are well under the ~1 s felt-wait threshold. (The slow path — the native
security-key ceremony — already *does* have the spinner.)

## Finding & fix

**Found by looking, not by asserting** — all 15 assertions were green while this was wrong.

**Defect:** the two MFA components rendered **unstyled default browser controls** (white
inputs, gray buttons) inside the otherwise-polished Aurora dark theme. Worst offender was
the **second-factor unlock gate** (`MfaPrompt`), which a user hits on *every* unlock — it
looked like a raw web form bolted into the app. Also affected: the TOTP confirm input and
the "Register security key / passkey" button.

**Root cause:** Svelte component-scoped styles. `VaultSidebar` styles its own
inputs/buttons, but its children `MfaEnroll`/`MfaPrompt` defined no control styles, so
their `<input>`/`<button>` fell back to UA defaults.

**Fix:** gave both components the same Aurora control styling used elsewhere
(`--chrome-hi` inputs with focus ring, `--accent` primary buttons), demoted the
security-key options to subtle secondaries to match the sidebar's visual hierarchy, and
sized the "Second factor" heading to match. Re-ran the full pass — screens `03`, `04`,
`08`, `09` are now consistent with the rest of the app. `svelte-check` clean; all
**18 e2e + 17 unit** tests still pass (no regression).

## Security / trust boundary

| Guarantee | How it was checked here | Result |
|---|---|---|
| Web pages can't reach the vault API | In-page probe of `window.secureBrowser` | `undefined` ✅ |
| Tab pages are sandboxed (no Node) | In-page probe of `require`/`module`/`process` | all `undefined` ✅ |
| Secrets not shown by default | Credential list before Reveal | masked ✅ |
| Secrets dropped on lock | Reveal → Lock → list/secret gone | cleared ✅ |
| No silent cross-origin fill | Autofill on a mismatched origin | no overlay, no fill ✅ |
| Fill requires a user gesture | Password value before clicking the candidate | empty until click ✅ |

## Internet connectivity

It's a real Chromium browser, and it reaches the live internet — verified, not assumed
(see [`connectivity.spec.ts`](./connectivity.spec.ts)):

| Site | Loaded URL | Title | Live-DOM proof |
|---|---|---|---|
| `example.com` | `https://example.com/` | "Example Domain" | `<h1>` = "Example Domain", 129 chars body text |
| `wikipedia.org` | `https://www.wikipedia.org/` | "Wikipedia" | **376** anchors rendered from the live page |

(The tab content looks black in the chrome-UI screenshots above only because tabs are
native `WebContentsView` overlays that a chrome-page screenshot can't see — the tab
captures `NET-1`/`NET-2` show the real, fully-rendered live pages.)

## Scope & limits

- **Security-key / CTAP2 second factor** is hardware-dependent (requires a physical key
  touch) and is validated manually per [`tests/manual/webauthn-hardware-ceremony.md`](../manual/webauthn-hardware-ceremony.md).
  The automated journey uses TOTP as the second factor; the security-key register/unlock
  buttons and their busy-spinner are exercised by `mfa.spec.ts` and code review.
- **Auto-lock** (5-min idle) is wired via the `vault:auto-locked` listener and verified by
  code inspection; it is not driven live here (a 5-minute idle wait per run isn't worth it).
- **`connectivity.spec.ts` requires outbound network** (it loads real public sites). The
  rest of the suite is fully self-contained (local fixtures only).

## Follow-up: impeccable design pass

After the acceptance pass, the renderer was run through `/impeccable audit` then a
warmth/clarity pass (onboarding + plain copy + WCAG AA + gentle motion), and verified by
a 5-dimension adversarial review (brand-fit, a11y with computed contrast, anti-patterns,
regression+security, copy). The screenshots above reflect this post-pass UI.

What changed: first-run reassurance ("encrypted and stays on this device"), a teaching
empty state, plain-words 2FA copy ("authenticator app", "setup key", "One more step"),
the "Citadel" name removed from the address bar, a styled success check (no OS emoji),
a de-bounced success animation (ease-out, no overshoot), tokenized colors, a
visually-hidden `<h1>` landmark, a ≥24px tab-close target, and the second-factor error
moved inline (so the calm heading leads, not a red banner).

Adversarial review caught two real WCAG AA contrast misses (`.reassure-note` and the
`or` divider at 3.76:1) that green tests and my own eyeballing missed; both were raised to
`--text-dim` (≈6:1) and re-verified. Audit health moved from **16/20** to **~19/20**
(remaining: a pre-existing nested-interactive role on the tab element, and nav glyphs vs
inline SVG — both tracked as out-of-scope follow-ups). Save-on-submit (the Chrome-style
"offer to save") is covered for account creation by `signup-save.spec.ts` and was also
verified live against a real public site (the-internet.herokuapp.com).
