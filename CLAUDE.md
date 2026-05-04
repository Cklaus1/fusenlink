# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FusenLink is a Manifest V3 Chrome extension (`manifest.json` → "FusenLink — AI LinkedIn Automation") that automates LinkedIn workflows via a **data-driven playbook engine**. Workflows ("playbooks") and their DOM selectors are JSON, not code: when LinkedIn changes its UI, the fix is usually a selector-registry edit rather than an extension rebuild. The system also ships a Node.js **WebSocket sidecar** + **CLI** so playbooks can be triggered from the terminal.

## Common Commands

```bash
npm install              # Install extension dev deps
npm run build            # Webpack → dist/{background,content,options,popup}.bundle.js
npm test                 # Run jest (jsdom + jest-chrome)
npx jest tests/engine.test.js          # Single file
npx jest -t "selectorResolver"         # Pattern match a describe/it name

# Sidecar + CLI (optional)
cd sidecar && npm install && npm start # Prints AUTH_TOKEN on startup
export FUSENLINK_TOKEN=<token from sidecar>
node cli/bin/fusenlink.js playbooks
```

Loading the extension: open `chrome://extensions/`, enable Developer Mode, "Load unpacked", select repo root. `dist/` is committed so this works without a local build.

Note: `build.sh` and the legacy `content.js`/`invitations.js`/`search.js`/`lib/*` files referenced in older docs no longer exist — webpack is the only build path.

## High-Level Architecture

Three runtime processes plus an optional terminal client:

```
Popup / Options page ──┐
                       ▼
              Background service worker (dist/background.bundle.js)
                       │   chrome.runtime messaging
                       ▼
              Content script (dist/content.bundle.js, on linkedin.com)
                       ▲
                       │   WebSocket :9333  (optional)
                       │
              Sidecar (sidecar/server.js) ◄── HTTP ──  CLI (cli/bin/fusenlink.js)
```

### Background service worker — `src/background/`

`index.js` wires together a fixed set of singletons; each owns one concern and is invoked through the central **`message-router.js`**. The router dispatches every `chrome.runtime.sendMessage` and every WS-bridged CLI request through the same switch on `message.action`, so the CLI and the popup hit identical code paths.

- `playbook-store.js` — CRUD for playbooks/selectors/settings in `chrome.storage.local`. Seeds defaults from `src/defaults/` on first install.
- `ai-client.js` — Multi-provider LLM client. Hits `POST {baseUrl}/chat/completions` (OpenAI-compatible: Ollama, vLLM, SGLang, OpenRouter, NIM, OpenAI). Anthropic native API has a translation adapter. Has retry-with-backoff for 429/5xx, validates `baseUrl` (HTTPS required except localhost).
- `scheduler.js` — `chrome.alarms`-backed recurring playbook runs. Restored on service worker wake.
- `sequence-manager.js` — Multi-step outreach drip; `initSequenceManager` runs hourly, `reply-detector.js` polls inbox every 6h to halt sequences when someone replies.
- `cohort-manager.js` — Hourly sync of shared "cohort" data (leaderboard, content calendar, warm intros).
- `data-store.js` — Append-only collections (`data.contacts`, `data.inbox`, `data.activityLog`, …) keyed in `STORAGE_KEYS` (`src/shared/constants.js`).
- `ws-bridge.js` — Connects to the sidecar at `ws://localhost:9333/ws`. Messages received over WS are fed back into `handleMessage` (see `index.js`), which is why CLI and popup share a router.
- `updater.js` — Optional remote playbook update poller (currently disabled in `index.js`).

### Content script — `src/content/`

`index.js` (`ContentBridge`) is a thin orchestration layer:
1. Loads playbooks + selector registries from `chrome.storage.local` (with `src/defaults/` as fallback).
2. Watches LinkedIn's SPA URL changes (`url-watcher.js`) and reinjects buttons (`src/ui/button-injector.js`) per `playbook.urlPattern`.
3. On user click or `RUN_PLAYBOOK` message, instantiates a **`PlaybookEngine`** (`engine.js`) with the playbook JSON, the matching selector registry, and merged settings.

The **PlaybookEngine** is a step interpreter, not bespoke code. Each step has an `action` field that maps to a handler in `ACTION_REGISTRY` (`src/content/actions/index.js`). Adding a new capability = add a handler + reference it from a playbook; do not branch in the engine. Built-in control flow: `loop`, `forEach`, `conditional`, plus `breakIf` expressions evaluated by `expression.js`.

Three trust levels gate execution (`TRUST_LEVEL` in `src/shared/messages.js`):
- `auto` — runs unattended.
- `review` — engine pauses before any action in `WRITE_ACTIONS` (`click`, `typeText`, `handleInviteModal`, `navigateNext`) until the user approves via `src/ui/ai-panel.js`.
- `interactive` — full agent loop; the AI proposes ≤5 steps per turn (see `INTERACTIVE_SYSTEM_PROMPT` in `engine.js`), engine runs them, repeats.

The **SelectorResolver** (`selector-resolver.js`) takes a registry key (e.g. `acceptButton`) and tries an ordered list of `strategies` (`css`, `cssWithText`, `ariaLabel`, `textExact`, `textMatch`, `hasChild`) with optional `scope` (document / modal / dropdown) and filters (`visible`, `enabled`, `notExtensionUI`, …). When LinkedIn breaks something, **first edit the registry** in `src/defaults/selectors.js` (or via the options page, which writes to storage) — only touch JS if a new strategy type is needed.

### UI — `src/ui/`

- `popup.js` — Toolbar launcher, lists playbooks filtered by current tab URL.
- `options.js` — Settings + AI config + raw JSON editor for playbooks/selectors.
- `overlay.js` — Floating progress UI rendered from inside content scripts.
- `button-injector.js` — Adds per-page action buttons matching `playbook.urlPattern`.
- `ai-panel.js` — User-facing approval prompts (the `prompt` action) and AI agent step display.

### Sidecar + CLI — `sidecar/`, `cli/`

Why a sidecar exists: a Chrome extension service worker cannot host an HTTP server, so `sidecar/server.js` runs as `node sidecar/server.js`, exposing HTTP on `:9333` and a WS endpoint at `/ws`. The extension's `ws-bridge.js` connects out to the WS, the CLI calls the HTTP API, and the sidecar forwards each HTTP request as a WS message keyed by `_requestId` so the response can be correlated.

Auth: HTTP API requires `Authorization: Bearer $FUSENLINK_TOKEN`; comparison uses `crypto.timingSafeEqual`. Token is auto-generated on startup or read from `FUSENLINK_TOKEN`. Health check at `/api/health` is the only unauthenticated route.

CLI (`cli/bin/fusenlink.js`) is plain Node — no deps. `cli/lib/client.js` wraps `http.request`. Subcommands: `run`, `stop`, `status`, `playbooks`, `schedule`, `data`, `ai`, `health`.

## Playbook & Selector Data Model

Playbooks live in `src/defaults/playbooks.js` (and editable via options page → `chrome.storage.local`). Each playbook has:

```js
{
  id, version, name, description,
  urlPattern,            // regex tested against location.href to decide button injection
  selectors,             // registry key in DEFAULT_SELECTOR_REGISTRIES
  trustLevel,            // 'auto' | 'review' | 'interactive'
  settings: { delayMs, maxItems, securityCheckEnabled, ... },
  steps: [               // executed by PlaybookEngine
    { action: 'findAll', selector: 'acceptButton', var: 'buttons' },
    { action: 'loop', breakIf: '$stopRequested', steps: [...] },
    ...
  ]
}
```

Variables prefixed `$` (e.g. `$processedCount`, `$settings.maxItems`) are resolved by `src/content/expression.js` against the engine's `vars` bag. `settings.maxItems` and `settings.delayMs` are auto-merged from user settings (`maxInvites` / `delayMs`) at run time — see `runPlaybook` in `src/content/index.js`.

`PLAYBOOK_URLS` (`src/shared/constants.js`) maps playbook IDs to canonical LinkedIn URLs the popup uses for "Run on right page" deep-links (a `null` value means the playbook works on any page in its category, e.g. any `/in/` profile).

## Testing

- Jest + jsdom, `tests/setup.js` registers `jest-chrome` to mock `chrome.*` APIs.
- Coverage scope: `src/**/*.js` only (`jest.config.js`).
- The Puppeteer test (`tests/integration.test.js`) requires a real Chrome with the extension loaded — usually skipped in CI.
- Tests directly import ES modules from `src/` and exercise units in isolation; there is no end-to-end harness for the playbook engine against live LinkedIn.

## Conventions / Gotchas

- **All write actions go through the trust-level gate.** If you add a new destructive action handler, also add its name to `WRITE_ACTIONS` in `src/shared/messages.js`, otherwise `review` mode will silently let it through.
- **`MSG` constants in `src/shared/messages.js` are the canonical wire format.** The router still accepts a few legacy `action: 'getSettings'` names for back-compat; new code should reference `MSG.*`.
- **Default settings live in two places by design.** Playbook-level `settings` (in the JSON) define per-workflow defaults; user-level `settings` (`maxInvites`, `delayMs`) override them at run time. `runPlaybook` merges them — don't read user settings inside step handlers.
- **Storage is `chrome.storage.local`, not `sync`.** Some data (contacts, activity log) can grow large enough to exceed `sync` quotas; `STORAGE_KEYS` is the only place to look up canonical keys.
- **`dist/` is committed.** Run `npm run build` after touching anything in `src/` if you want the loaded extension to reflect changes.
- **Git remote uses SSH:** `git@github.com:Cklaus1/fusenlink.git`.
