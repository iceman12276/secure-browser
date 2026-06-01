# Product

## Register

product

## Users

A single, privacy-conscious individual using this as their everyday browser — and
people like them who want a password manager that never touches the cloud. The
builder is the first user; "learning first, personal daily use second."

Critically, the bar is set by a **non-technical first-timer**: someone who has never
seen the app must create a vault, turn on two-factor, and use autofill *unaided* — no
dead ends, no jargon, no raw errors. They are in a real task (logging into a site),
not admiring the UI.

## Product Purpose

A local-first, zero-knowledge web browser with an embedded password manager. It owns
the browser so autofill works end-to-end, with no server, no cloud, and no account.
Ciphertext lives in an encrypted SQLite file on disk; vault plaintext and the master
key live only in the Rust core while unlocked and are zeroized on lock. Secrets cross
to a web page only at fill time, for one credential, after a user gesture and an exact
origin match.

Success looks like: a non-technical person creates a vault, enrolls a second factor,
and fills passwords daily — trusting the tool — without ever sending a secret anywhere.

## Brand Personality

**Friendly, reassuring, approachable.** Security made non-scary. The product should
feel like a calm guide, not a fortress wall or a security console. Warm and
encouraging over stern; gentle, state-conveying motion over flash; plain reassuring
copy over acronyms. A first-timer should feel *held*, not tested.

Voice: plain, calm, encouraging. Name the thing in human words ("authenticator app",
not "TOTP"). Confirm success out loud. Never alarm.

## Anti-references

- **Crypto / web3 neon**: gradient glows, glassmorphism, "cyber" sheen. The opposite
  of trustworthy here.
- **Generic AI-SaaS**: cream/sand backgrounds, gradient-text headings, tiny tracked
  eyebrow kickers, identical icon-card grids. Reads as template, not product.
- (Also not a **dense corporate security console** — tiny gray-on-gray tables, admin density.)

## Design Principles

1. **Reassure, don't alarm.** Every security moment (create, lock, unlock, enroll,
   fill) should build confidence with an explicit, friendly confirmation — never leave
   the user hoping it worked, never scare them about what could go wrong.
2. **Teach the first-timer.** First-run and empty states guide and explain; nobody
   should face a bare form or a dead end. The interface teaches itself.
3. **The tool disappears into the task.** Earned familiarity: standard affordances, the
   same component vocabulary on every screen. No invented controls, no surprises.
4. **Trust is shown, not claimed.** Make the zero-knowledge guarantee legible — secrets
   masked by default, explicit gestures to reveal/fill, "stays on this device" — without
   lecturing or jargon.
5. **Plain words over jargon.** Copy a non-technical person understands. Acronyms get a
   human name and a one-line "why."

## Accessibility & Inclusion

Target **WCAG 2.1 AA** (the standard the UX acceptance pass is held to). Fully
keyboard-operable with a visible focus ring; `prefers-reduced-motion` honored on every
animation; errors are human-readable, never a raw stack or `[object Object]`; color is
never the only signal of state (pair it with an icon or text).
