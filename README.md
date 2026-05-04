# FusenLink — AI-Powered LinkedIn Automation

A Chrome extension that automates LinkedIn networking with a dynamic playbook engine, AI integration, and CLI control.

## Features

### Automation Playbooks
- **Accept / Deny All** — One-click bulk processing of pending invitations
- **Bulk Connect** — Send connection requests across search results with auto-pagination
- **Extract Contacts** — Scrape your connections list into structured JSON/CSV data
- **AI Profile Review** — AI analyzes your profile and suggests improvements
- **AI Inbox Analysis** — AI classifies and prioritizes your LinkedIn messages
- **Custom Playbooks** — Add your own workflows as JSON — no code changes needed

### AI Integration (Multi-Provider)
Supports **Ollama**, **vLLM**, **SGLang**, **OpenRouter**, **NVIDIA NIM**, **OpenAI**, and **Anthropic**. Run local models for privacy or cloud models for power.

### Playbook Engine
Workflows and selectors are **data, not code**. When LinkedIn changes their UI, update a selector registry — no extension rebuild required. The engine supports 30+ action types: DOM extraction, AI calls, approval prompts, typed input, navigation, and more.

### Scheduling
Schedule playbooks to run on a recurring basis (e.g., auto-accept invitations daily) via `chrome.alarms`.

### CLI + WebSocket Bridge
Control the extension from your terminal:
```bash
fusenlink playbooks                    # List available skills
fusenlink run accept-invites           # Run a playbook
fusenlink data contacts --format csv   # Export extracted data
fusenlink schedule set accept-invites 1440  # Schedule daily
fusenlink ai status                    # Check AI provider
```

### Trust Levels
Each playbook declares a trust level:
- **auto** — runs without interaction (bulk actions, extraction)
- **review** — AI proposes, user approves before destructive actions
- **interactive** — full AI agent loop with user oversight

## Installation

1. Clone and build:
   ```bash
   git clone https://github.com/Cklaus1/fusenlink.git
   cd fusenlink
   npm install
   npm run build
   ```

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the project directory

3. (Optional) Set up AI:
   - Click the FusenLink icon in the toolbar
   - Go to Settings > AI Configuration
   - Select your provider and model

4. (Optional) Set up CLI:
   ```bash
   cd sidecar && npm install && npm start
   export FUSENLINK_TOKEN=<token from sidecar output>
   node cli/bin/fusenlink.js playbooks
   ```

## Usage

Click the **FusenLink icon** in the Chrome toolbar to see all available playbooks. Each shows which LinkedIn page it runs on and whether it requires AI.

### Quick Start
1. Navigate to LinkedIn
2. Click the FusenLink toolbar icon
3. Click "Run" on any playbook

### AI Features
1. Go to Settings > AI Configuration
2. Select a provider (Ollama for local, OpenRouter for cloud)
3. AI playbooks will appear with an "AI" badge in the popup

## Architecture

```
Popup (toolbar launcher)
  |
Background Service Worker
  ├── MessageRouter (dispatch)
  ├── PlaybookStore (CRUD)
  ├── AIClient (multi-provider LLM)
  ├── DataStore (contacts, inbox, logs)
  ├── Scheduler (chrome.alarms)
  └── WS Bridge (CLI access)
  |
Content Script (linkedin.com)
  ├── PlaybookEngine (step interpreter)
  ├── Action Registry (28 action handlers)
  ├── SelectorResolver (fallback chains)
  └── Overlay UI + AI Panel
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build extension bundles
npm test             # Run 121 tests
```

## Security

- Only runs on LinkedIn domains
- No external data transmission (all data stays in chrome.storage.local)
- Sidecar requires auth token for CLI access
- AI API keys stored locally, never transmitted except to configured provider
- Timing-safe token comparison

## License

[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](LICENSE.md)
