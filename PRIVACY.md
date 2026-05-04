# Privacy Policy for FusenLink

## Last Updated: March 28, 2026

### Introduction

This Privacy Policy explains how FusenLink ("we", "our", or "extension") handles user data. FusenLink automates LinkedIn networking tasks with optional AI-powered features, while keeping your data under your control.

### Data Storage

**All data stays on your device by default.**

- **Settings and Playbooks**: Stored locally in your browser using `chrome.storage.local`.
- **Extracted Data**: Contacts, inbox analyses, profile reviews, and activity logs are stored locally in `chrome.storage.local`. This data never leaves your browser unless you explicitly export it.
- **No External Servers**: FusenLink does not operate any backend servers. There is no FusenLink account, no telemetry, and no analytics.

### AI Features (Optional)

FusenLink offers optional AI-powered features (profile review, inbox analysis, reply drafting). These features require you to configure an LLM provider of your choice. When you use AI features:

- **Data sent to your chosen provider**: The specific LinkedIn page data needed for the AI task (e.g., profile text, conversation previews) is sent to the LLM provider you configured (e.g., Ollama running locally, OpenRouter, OpenAI, Anthropic, etc.).
- **You control the provider**: FusenLink does not choose, mandate, or intermediate the LLM provider. You enter the base URL and API key yourself.
- **Local providers send no data externally**: If you use a local provider like Ollama, all AI processing happens on your machine.
- **No data is sent without your action**: AI features only activate when you explicitly run an AI playbook. No background AI processing occurs unless you schedule it.
- **API keys stored locally**: Your API key is stored in `chrome.storage.local` on your device. It is only sent to the provider you configured.

### CLI / Sidecar (Optional)

FusenLink offers an optional CLI tool that communicates with the extension via a local WebSocket sidecar process. This connection is:

- **Localhost only**: The sidecar listens on `localhost:9333` and is not accessible from the network.
- **Token-authenticated**: A random authentication token is required for all API calls.
- **No external communication**: The sidecar bridges your terminal to the extension. No data is sent externally.

### Permissions

FusenLink requires these permissions:

- **activeTab**: To interact with LinkedIn pages when you trigger a playbook.
- **scripting**: To inject automation UI (buttons, overlays) into LinkedIn pages.
- **storage**: To save settings, playbooks, and extracted data locally.
- **alarms**: To support scheduled recurring playbook execution.
- **notifications**: To notify you when scheduled playbooks complete.

These permissions are used only on the LinkedIn domain (`*.linkedin.com`) as specified in the manifest, and only for the functions described in the extension.

### What We Do NOT Do

- We do not collect personal information.
- We do not transmit data to FusenLink servers (we have none).
- We do not use analytics, tracking, or telemetry.
- We do not sell, share, or monetize any user data.
- We do not access LinkedIn credentials or session tokens beyond what the browser provides to content scripts.

### Changes to This Policy

We will update this Privacy Policy when the extension's functionality changes. Updates are noted in the "Last Updated" date above. Significant changes (e.g., adding a backend service) will be communicated via the GitHub repository.

### Contact

If you have questions about this Privacy Policy or FusenLink, please open an issue at https://github.com/Cklaus1/fusenlink.

This extension is provided under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0).
