Chrome Extension — LinkedIn Bulk-Actions
Developer-Ready Specification
(v 0.9 – May 9 2025)

1 · Overview
Item	Details
Problem	Accepting/denying hundreds of invitations or sending many identical connection requests is slow and repetitive on LinkedIn.
Goal	A Chrome extension that adds three inline controls:
• Accept All – bulk-accept every pending invitation (auto-scroll)
• Deny All – bulk-ignore every pending invitation (auto-scroll)
• Invite ≤ N – send up to a user-defined number of connection requests on any search-results page.
Success Metrics	✅ One-click bulk actions complete without manual intervention.
✅ Live overlay shows progress, “Stop” control, and final summary.
✅ User-configurable max-invite count & per-click delay via Options page.
✅ No LinkedIn UI corruption; normal use remains unaffected.
✅ < 0.5 s added first-paint cost on LinkedIn pages.

2 · Functional Requirements
Inline Buttons

Inject Accept All & Deny All at top-left of /mynetwork/invitation-manager/.

Inject Invite ≤ N near the horizontal filter bar on any /search/results/ page.

Bulk Accept / Deny

Auto-scroll until no further invitations load.

Click appropriate action button on each card.

Auto-dismiss “Say hello”, “Follow” or any intervening modal.

Bulk Invite

Read maxInvites from storage; stop when reached or when no more “Connect” buttons.

Skip cards whose buttons show “Pending”, “Follow”, “InMail”.

If “Connect” is hidden in “More” dropdown, open dropdown and click it.

Overlay UI

Fixed bottom-right floating panel (z-index ≥ 9999).
Shows [Action] • processed / total • elapsed s and a red Stop button.

Clicking Stop aborts current loop gracefully.

Settings (chrome://extensions/?options)

Inputs: maxInvites (integer ≥ 1, default 50) and delayMs (integer ms, default 1500 ms).

Stored via chrome.storage.sync.

Security Challenges

If CAPTCHA/interstitial detected → pause loop, surface overlay message “Action paused – resolve challenge to continue”; resume once DOM element gone.

Internationalisation

Button-text selectors use data-test-ids where available; fallback to regex on common English labels only.

Permissions & Manifest

Manifest v3, “activeTab”, “scripting”, “storage”.

Content-scripts limited to https://www.linkedin.com/*.

Performance

Content script idle unless URL matches target patterns.

Overlay removed when no longer needed.

3 · Non-Functional Requirements
Aspect	Requirement
Performance	≤ 0.5 s script eval per page; ≤ 10 MB memory footprint during bulk loops.
Security	No remote code; complies with Chrome CSP.
Scalability	Handles ≥ 2 000 invites in one run without crash.
Compliance	Does not store or transmit profile data externally.
Accessibility	Overlay ARIA role = status; focusable Stop button.
Browser Support	Chrome ≥ 124 (MV3), Chromium-based Edge.

4 · Architecture Choices
Layer	Tech	Justification
UI Injection	vanilla JS + Lit-std-lib template strings	zero external deps ⇒ small bundle
State Mgmt	chrome.storage.sync	syncs across user’s Chrome profile
Delay / Loop	async/await recursion + AbortController	simpler than RxJS for small scope
Testing	Jest + Puppeteer (headless Chrome)	full DOM & network simulation
Build	Vite + esbuild, output ES2022	fast build & tree-shaking

5 · Data Handling
Config: { maxInvites: number, delayMs: number } – stored via chrome.storage.sync.

Runtime Stats (in-memory only): { processed, total, startTime, aborted }.

No PII persisted or transmitted.

6 · Error Handling & Resilience
Scenario	Strategy
Button not found	Skip item, increment skipped.
Network/DOM mutation mid-click	Retry element lookup once; if still missing, skip.
CAPTCHA / invite-limit dialog	Pause loop, show overlay, wait user dismissal.
User clicks Stop	AbortController cancels timeouts; overlay shows “Cancelled – X processed”.

7 · Testing Plan
Unit

Selector utilities, delay timer, storage wrapper.

Integration

Mock LinkedIn DOM fragments; ensure correct nodes clicked & overlay counts.

End-to-End (Puppeteer)

Seed dummy invitations & search results.

Verify full-run completes, overlay hides.

Acceptance

Manual run on real LinkedIn account behind feature-flag limiting to 10 actions.

Blueprint & Prompt-Plan
(The build is broken into 14 incremental steps → prompts follow.)

prompt_plan.md
markdown
Copy
Edit
# prompt_plan.md

## 1 · Scaffold Manifest V3
```prompt
You are ChatGPT-Code.  
Create `manifest.json` for a Chrome MV3 extension named “LinkedIn Bulk Actions”.  
– Permissions: activeTab, scripting, storage  
– Content scripts:  
  * invitations.js → matches https://www.linkedin.com/mynetwork/invitation-manager/*  
  * search.js     → matches https://www.linkedin.com/search/results/*  
– Service worker: background.js  
Return valid JSON only.  
markdown
Copy
Edit
## 2 · Background Service Worker
```prompt
Add `background.js`.  
Responsibilities:  
1. Listen for `chrome.runtime.onInstalled` → set defaults `{ maxInvites:50, delayMs:1500 }`.  
2. Expose `getSettings()` & `setSettings()` via `chrome.runtime.onMessage`.  
Implement with ES modules & top-level await.  
markdown
Copy
Edit
## 3 · Options Page HTML
```prompt
Create `options.html` + `options.js` with a simple form:  
Inputs: number#maxInvites, number#delayMs (ms).  
Load current settings on DOMContentLoaded; save on submit; show “Saved!” toast.  
Link stylesheet inline.  
markdown
Copy
Edit
## 4 · Utility Module
```prompt
Create `lib/settings.js` exposing:  
`export async function getSettings()` and `export async function updateSettings(patch)` that proxy to background.  
Use `chrome.runtime.sendMessage`.  
markdown
Copy
Edit
## 5 · Overlay Component
```prompt
Implement `lib/overlay.js`.  
Functions: `showOverlay(label)`, `updateOverlay(processed,total)`, `showSummary(text)`, `hideOverlay()`, `onStop(cb)`.  
Render a bottom-right fixed div with id `li-bulk-overlay`.  
markdown
Copy
Edit
## 6 · Invitations Content Script Boilerplate
```prompt
Create `invitations.js`.  
On DOM ready, inject two buttons “Accept All” & “Deny All” into a flex container before the page’s primary header.  
Style minimally: background #0a66c2, white text.  
Add click handlers (empty for now).  
markdown
Copy
Edit
## 7 · Accept-All Algorithm
```prompt
Inside invitations.js implement `async function acceptAll()`.  
Logic:  
1. Call `showOverlay("Accepting…")`.  
2. While true:<br>  a. For each visible button[text()="Accept"], click, await 250 ms.<br>  b. Auto-dismiss any modal with `button[aria-label="Dismiss"]`.<br>  c. Scroll to bottom; if no new cards after 800 ms, break.  
3. `showSummary("Accepted ${count} invitations")`.  
Abort when `stopRequested` flag is set.  
markdown
Copy
Edit
## 8 · Deny-All Algorithm
```prompt
Reuse acceptAll pattern but target button[text()="Ignore"] and summary “Denied …”.  
Factor shared loop into `processInvites(actionLabel, selector)`.  
markdown
Copy
Edit
## 9 · Security Pause Handler
```prompt
Within invitations.js loop, detect presence of `iframe[src*="challenge"]` or div[text()*="limit"].  
If found: `updateOverlay("Paused – resolve challenge")` and `await waitUntilGone()`.  
markdown
Copy
Edit
## 10 · Search Content Script Boilerplate
```prompt
Create `search.js`.  
Inject button “Invite ≤ N” beside the Filters bar.  
Button label should read actual maxInvites from settings.  
markdown
Copy
Edit
## 11 · Invite Loop
```prompt
Add `async function inviteUpTo(max)` in search.js.  
Steps:<br>1. `showOverlay("Inviting…")`.<br>2. Gather visible connect selectors:<br>  • button[text()="Connect"]<br>  • span[text()="Connect"]/ancestor::button<br>3. For each:<br>  a. Click.<br>  b. If confirmation modal appears, click button[text()="Send now"].<br>  c. Wait `delayMs`.<br>  d. Increment processed.<br>  e. Break when processed == max.<br>4. Auto-scroll to load more until done or reached max. |
markdown
Copy
Edit
## 12 · Dropdown Support
```prompt
Extend invite loop: if no direct Connect button, click button[...]text()="More", then menuitem[text()="Connect"].  
Ensure menu closes afterwards.  
markdown
Copy
Edit
## 13 · Stop Functionality
```prompt
In overlay.js wire **Stop** button → set global `stopRequested`.  
Each loop checks flag and exits.  
Show summary “Cancelled – {processed} done”.  
markdown
Copy
Edit
## 14 · Jest + Puppeteer Tests
```prompt
Write a Jest test that launches Chrome with the unpacked extension, loads a stub invitations HTML, and asserts total accepted equals card count.  
Mock `chrome.storage.sync` with jest-chrome.  
css
Copy
Edit

---

### todo.md
```markdown
- [ ] Manifest V3 scaffold  
- [ ] Background service worker with default settings  
- [ ] Options page (HTML + JS)  
- [ ] settings.js utility  
- [ ] overlay.js UI module  
- [ ] invitations.js – inject buttons  
- [ ] invitations.js – acceptAll loop  
- [ ] invitations.js – denyAll loop  
- [ ] invitations.js – security-pause handling  
- [ ] search.js – inject Invite ≤ N button  
- [ ] search.js – inviteUpTo loop  
- [ ] search.js – dropdown Connect support  
- [ ] overlay Stop logic  
- [ ] Jest + Puppeteer integration tests
