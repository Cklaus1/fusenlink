# PRD: FusenLink Autopilot

**Product Requirements Document**
**Version:** 1.0
**Date:** 2026-03-18
**Author:** FusenLink Team
**Status:** Draft

---

## 1. Executive Summary

FusenLink Autopilot transforms FusenLink from a manual bulk-action Chrome extension into an AI-powered LinkedIn networking agent. It combines always-on browser automation with LLM intelligence to monitor feeds, manage inboxes, nurture connections, and execute networking strategies — all with configurable autonomy levels.

**Vision:** LinkedIn networking that runs in the background, surfaces what matters, and acts on your behalf — so you spend 10 minutes a day on LinkedIn instead of 90.

**Target Users:** Sales professionals, recruiters, founders, business development reps, and growth marketers who rely on LinkedIn as a primary channel but lack time to engage consistently.

---

## 2. Problem Statement

### The LinkedIn Engagement Gap

LinkedIn rewards consistency. The professionals who win on the platform engage daily: accepting invitations thoughtfully, responding to messages promptly, commenting on key contacts' posts, and sending personalized connection requests. Most users can't sustain this.

**Current pain points:**

| Problem | Impact |
|---|---|
| Inbox overload | Important messages buried under spam and InMails |
| Missed feed activity | Users don't see posts from key prospects/contacts |
| Generic outreach | Bulk tools send identical requests, yielding 10-15% acceptance rates |
| No follow-through | Connections are accepted and never nurtured |
| Manual time drain | Effective LinkedIn networking takes 60-90 min/day |
| Inconsistency | Users engage heavily for a week, then go silent for a month |

### What Exists Today (FusenLink v1)

FusenLink v1 solves the most mechanical layer: bulk accept/deny invitations and bulk send connection requests via a Chrome extension. It has no intelligence, no personalization, and requires the user to be actively on the page.

### The Opportunity

Layer AI onto the existing automation foundation to create a system that:
1. **Decides** who to connect with, accept, or ignore
2. **Writes** personalized messages that sound human
3. **Monitors** the network passively and surfaces actionable insights
4. **Operates** autonomously on a schedule, with user-defined guardrails

---

## 3. Product Overview

### 3.1 Product Name

**FusenLink Autopilot**

### 3.2 Product Pillars

1. **Autopilot Mode** — Scheduled, autonomous LinkedIn actions via a remote agent
2. **Smart Networking** — AI-scored connections, personalized outreach, follow-up sequences
3. **Feed Intelligence** — Watchlist monitoring, activity digests, engagement opportunities
4. **Inbox Copilot** — Message classification, priority surfacing, AI-drafted reply options

### 3.3 System Architecture

```
┌──────────────────────────────────────────────────────┐
│                   User Interfaces                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Chrome   │  │ Web          │  │ Slack/SMS      │  │
│  │ Extension│  │ Dashboard    │  │ Notifications  │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬────────┘  │
└───────┼────────────────┼─────────────────┼───────────┘
        │                │                 │
        ▼                ▼                 ▼
┌──────────────────────────────────────────────────────┐
│              Autopilot Agent Server                   │
│                                                       │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ Scheduler   │  │ Task     │  │ Agent Engine     │  │
│  │ (cron jobs) │  │ Queue    │  │ (orchestrator)   │  │
│  └──────┬──────┘  └────┬─────┘  └────────┬────────┘  │
│         │              │                  │           │
│  ┌──────▼──────────────▼──────────────────▼────────┐  │
│  │              Specialized Agents                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │  │
│  │  │ Scanner  │ │ Writer   │ │ Strategist       │ │  │
│  │  │ (reads   │ │ (drafts  │ │ (plans sessions, │ │  │
│  │  │  pages)  │ │  msgs)   │ │  manages quotas) │ │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘ │  │
│  └─────────────────────┬───────────────────────────┘  │
│                        │                              │
│  ┌─────────────────────▼───────────────────────────┐  │
│  │          LLM Layer (Claude API)                  │  │
│  │  - Profile scoring    - Message drafting         │  │
│  │  - Intent classifying - Content summarizing      │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                              │
│  ┌─────────────────────▼───────────────────────────┐  │
│  │       Browser Automation (Playwright)            │  │
│  │  - Navigates LinkedIn    - Reads DOM             │  │
│  │  - Clicks/types          - Extracts data         │  │
│  └─────────────────────────────────────────────────┘  │
│                        │                              │
│  ┌─────────────────────▼───────────────────────────┐  │
│  │       Data Layer (SQLite)                        │  │
│  │  - Connection history    - Message logs          │  │
│  │  - Watchlists            - Sequence state        │  │
│  │  - Activity analytics    - User preferences      │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 3.4 Deployment Model

- **Local-first:** Agent server runs on the user's machine (Node.js process)
- **Browser session:** Uses Playwright with the user's authenticated LinkedIn cookies
- **No credential storage:** Never stores LinkedIn username/password — authenticates via existing browser session
- **Optional cloud:** Future SaaS version with managed browser sessions

---

## 4. Feature Requirements

### 4.1 Phase 1 — Autopilot Foundation

**Goal:** Remote agent server that executes LinkedIn tasks on a schedule without the user being on the page.

#### F1.1: Agent Server

| Attribute | Detail |
|---|---|
| **Description** | Node.js server that runs locally, manages task scheduling, and controls a Playwright browser instance |
| **Priority** | P0 |
| **Acceptance Criteria** | Server starts, authenticates to LinkedIn via browser cookies, executes a basic task (e.g., count pending invitations), and reports result |

#### F1.2: Session Management

| Attribute | Detail |
|---|---|
| **Description** | Import and maintain LinkedIn session from user's Chrome browser. Detect session expiry and notify user to re-authenticate |
| **Priority** | P0 |
| **Acceptance Criteria** | Agent can import cookies from Chrome, persist them, detect when session expires, and prompt user to refresh |

#### F1.3: Scheduled Auto-Accept

| Attribute | Detail |
|---|---|
| **Description** | Daily scheduled job that navigates to invitation manager and accepts/denies invitations based on configured rules |
| **Priority** | P0 |
| **Acceptance Criteria** | User configures schedule (e.g., "weekdays at 9am"), agent runs, processes invitations, reports summary |

#### F1.4: Task Scheduler

| Attribute | Detail |
|---|---|
| **Description** | Cron-based scheduler for recurring tasks with configurable frequency, time windows, and daily limits |
| **Priority** | P0 |
| **Acceptance Criteria** | User can create, list, pause, and delete scheduled tasks. Tasks respect daily LinkedIn activity limits |

#### F1.5: Activity Logging

| Attribute | Detail |
|---|---|
| **Description** | Log all agent actions to SQLite: what was done, when, to whom, outcome |
| **Priority** | P0 |
| **Acceptance Criteria** | Every invitation accepted, connection sent, and message drafted is logged with timestamp, profile URL, and action result |

---

### 4.2 Phase 2 — Smart Networking & Follow-Up Sequences

**Goal:** AI-powered connection decisions and automated follow-up messaging.

#### F2.1: Connection Scoring

| Attribute | Detail |
|---|---|
| **Description** | LLM scores each incoming invitation (0-100) based on relevance to user's defined networking goals |
| **Priority** | P0 |
| **Input** | Inviter's name, headline, mutual connections, profile summary, personal note (if any) |
| **Output** | Score (0-100), reasoning, recommended action (accept/ignore/deny) |
| **Acceptance Criteria** | User defines goals in natural language. Agent scores invitations and auto-accepts above threshold, queues borderline cases for review |

**Scoring factors:**

| Factor | Weight | Signal |
|---|---|---|
| Role/title match | High | Matches user's target personas |
| Industry alignment | High | Same or adjacent industry |
| Company signals | Medium | Company size, stage, relevance |
| Mutual connections | Medium | Quality and count of shared network |
| Profile completeness | Low | Photo, summary, experience filled out |
| Personal note quality | High | Personalized vs. generic vs. none |
| Spam indicators | Negative | Crypto, MLM, mass-connection patterns |

#### F2.2: Personalized Connection Notes

| Attribute | Detail |
|---|---|
| **Description** | When sending connection requests, LLM drafts a personalized note (max 300 chars) referencing the recipient's profile |
| **Priority** | P0 |
| **Input** | Recipient profile data, user's goal template, user's own profile context |
| **Output** | 1-3 draft notes ranked by relevance |
| **Acceptance Criteria** | Each note references something specific from the recipient's profile. No two notes in a batch are identical. Notes stay under LinkedIn's 300-char limit |

**Goal templates (user-configurable):**

```
Sales:      "I help {industry} companies with {value_prop}. Reference their
             recent work and suggest a brief conversation."

Recruiting: "We're building {what} at {company}. Compliment their background
             and mention why they'd be a great fit."

Networking: "Find genuine common ground. No pitch, just authentic connection."

Custom:     [User writes their own template with variables]
```

#### F2.3: Follow-Up Sequences

| Attribute | Detail |
|---|---|
| **Description** | After a connection is accepted, automatically queue a follow-up message sequence |
| **Priority** | P1 |
| **Acceptance Criteria** | User configures sequence (delay, number of touchpoints, goal). Agent drafts messages, queues them, and sends on schedule. Sequence stops if recipient replies |

**Default sequence:**

| Step | Timing | Content |
|---|---|---|
| 1 | 1 day after acceptance | Warm intro — thank for connecting, reference shared interest |
| 2 | 5 days after step 1 (if no reply) | Value-add — share relevant article/insight, light CTA |
| 3 | 7 days after step 2 (if no reply) | Direct — clear ask (call, meeting, feedback) |

**Rules:**
- Sequence immediately stops when recipient replies
- User can set global daily send limit (e.g., max 20 follow-ups/day)
- Messages are never identical — LLM personalizes each one
- User can require approval before send (review mode) or allow auto-send (trust mode)

#### F2.4: Trust Levels

| Attribute | Detail |
|---|---|
| **Description** | Configurable autonomy for each action type |
| **Priority** | P1 |

| Action | Trust Levels |
|---|---|
| Accept invitations | Auto (score > threshold) / Review all / Manual only |
| Send connections | Auto / Review notes before send / Manual only |
| Follow-up messages | Auto-send / Draft & queue for approval / Off |
| Inbox replies | Draft only (never auto-send) |

---

### 4.3 Phase 3 — Inbox Copilot

**Goal:** AI-assisted inbox management with classification, prioritization, and draft replies.

#### F3.1: Inbox Scanner

| Attribute | Detail |
|---|---|
| **Description** | Periodically scan LinkedIn inbox, extract conversations, classify by priority and intent |
| **Priority** | P0 |
| **Acceptance Criteria** | Agent reads inbox, extracts last N conversations, stores message content and metadata |

#### F3.2: Message Classification

| Attribute | Detail |
|---|---|
| **Description** | LLM classifies each conversation by priority and intent |
| **Priority** | P0 |

**Classification taxonomy:**

| Dimension | Values |
|---|---|
| **Priority** | Urgent / High / Medium / Low |
| **Intent** | Opportunity (job, deal, partnership) / Question / Introduction request / Follow-up / Networking / Spam / Automated/promotional |
| **Action needed** | Reply required / FYI only / Can ignore |

**Acceptance Criteria:** Classification accuracy > 85% on user-validated sample after 2 weeks of use.

#### F3.3: Reply Drafting

| Attribute | Detail |
|---|---|
| **Description** | For messages requiring a reply, generate 2-3 draft options with varying tone |
| **Priority** | P1 |

**Draft options per message:**

| Option | Tone | Use case |
|---|---|---|
| Option A | Professional & thorough | Important contacts, detailed responses |
| Option B | Friendly & concise | Casual networking, quick replies |
| Option C | Brief acknowledgment | Low-priority, closing the loop |

**Rules:**
- Drafts are NEVER auto-sent — inbox replies always require user approval
- User can edit any draft before sending
- Agent learns from user edits over time (which option they pick, what they change)

#### F3.4: Inbox Digest

| Attribute | Detail |
|---|---|
| **Description** | Daily summary of inbox activity delivered via notification channel |
| **Priority** | P2 |
| **Format** | "You have 3 high-priority messages, 2 new opportunities, and 8 messages that can wait. Here's the rundown..." |

---

### 4.4 Phase 4 — Feed Intelligence

**Goal:** Monitor key contacts' activity and surface engagement opportunities.

#### F4.1: Watchlist Management

| Attribute | Detail |
|---|---|
| **Description** | User maintains a list of LinkedIn profiles to monitor |
| **Priority** | P0 |
| **Acceptance Criteria** | User can add/remove profiles by URL or search. Watchlist stored in local database. Supports tagging (prospect, client, competitor, thought-leader) |

**Watchlist entry:**

```json
{
  "profile_url": "https://linkedin.com/in/janedoe",
  "name": "Jane Doe",
  "tags": ["prospect", "fintech"],
  "monitoring": {
    "posts": true,
    "job_changes": true,
    "company_news": true
  },
  "added_date": "2026-03-18",
  "notes": "CTO at TargetCo, evaluating our category"
}
```

#### F4.2: Feed Scanner

| Attribute | Detail |
|---|---|
| **Description** | Agent periodically visits watchlisted profiles and/or scans the home feed to capture recent posts |
| **Priority** | P0 |
| **Acceptance Criteria** | Agent captures post text, engagement metrics (likes, comments), media type, and posting date for watchlisted profiles |

#### F4.3: Activity Digest

| Attribute | Detail |
|---|---|
| **Description** | LLM-generated summary of watchlist activity, ranked by relevance and engagement opportunity |
| **Priority** | P1 |

**Digest format:**

```
FEED DIGEST — March 18, 2026

HOT (engage today):
  - Jane Doe (prospect/fintech) posted about scaling their
    data pipeline — 47 likes, 12 comments
    → Suggested comment: "Great insight on the partition
      strategy, Jane. We've seen similar patterns at..."

  - Mike Chen changed roles → now VP Eng at AcmeCorp
    → Suggested message: congratulate + reconnect

NOTABLE:
  - Sarah Kim shared an article on AI in recruiting
    (12 likes) — relevant to your outreach campaign
  - 2 prospects went quiet (no posts in 30 days)

STATS:
  - 14 watchlisted contacts posted this week
  - Your engagement rate: 6/14 (43%)
```

#### F4.4: Suggested Engagement

| Attribute | Detail |
|---|---|
| **Description** | For high-priority feed items, draft a suggested comment or message |
| **Priority** | P2 |
| **Rules** | Comments are substantive (no "Great post!"). References specific content. Matches user's voice/tone. Never auto-posts — user approves all public engagement |

---

## 5. Non-Functional Requirements

### 5.1 LinkedIn Safety & Compliance

| Requirement | Detail |
|---|---|
| **Rate limiting** | All actions respect configurable daily limits. Defaults: 50 connections/day, 100 accepts/day, 50 messages/day |
| **Human-like patterns** | Randomized delays (not fixed intervals), variable session lengths, natural scroll patterns |
| **Security detection** | Immediately pause all activity when LinkedIn shows a security challenge. Notify user. Do not retry until user resolves |
| **Session hygiene** | Vary session times. Never run 24/7. Configurable active hours (e.g., 8am-6pm weekdays) |
| **Compliance** | Users are responsible for compliance with LinkedIn's Terms of Service. Product provides guardrails but does not guarantee compliance |

### 5.2 Privacy & Data

| Requirement | Detail |
|---|---|
| **Local-first** | All data stored locally on user's machine (SQLite). No user data sent to FusenLink servers |
| **LLM data** | Profile data sent to Claude API for scoring/drafting is not stored by the LLM provider (use API with zero-retention) |
| **No credential storage** | LinkedIn credentials are never stored. Authentication via browser cookie import only |
| **Data retention** | User configurable. Default: 90 days for activity logs, indefinite for watchlists and sequences |
| **Export** | User can export all their data (connections, messages, logs) as JSON/CSV at any time |

### 5.3 Reliability

| Requirement | Detail |
|---|---|
| **Graceful degradation** | If LLM API is unavailable, agent falls back to rule-based decisions (accept all / skip) |
| **DOM resilience** | Selector strategies use multiple fallbacks (data attributes → aria labels → text content) to handle LinkedIn UI changes |
| **Crash recovery** | Agent server auto-restarts. In-progress sequences resume from last completed step |
| **Conflict avoidance** | Agent server and Chrome extension never run simultaneously on the same LinkedIn session |

### 5.4 Performance

| Requirement | Detail |
|---|---|
| **LLM latency** | Connection scoring < 3s per profile. Message drafting < 5s per message |
| **Batch efficiency** | Batch multiple profiles into single LLM calls where possible (e.g., score 10 invitations in one prompt) |
| **Resource usage** | Agent server < 500MB RAM. Playwright browser instance only active during scheduled tasks, closed between runs |

---

## 6. User Experience

### 6.1 Setup Flow (First Run)

```
1. Install Chrome extension (existing)
2. Install Autopilot server (npm install -g fusenlink-autopilot)
3. Run setup wizard:
   a. Import LinkedIn session from Chrome
   b. Define networking goals (natural language)
   c. Set trust levels (conservative defaults)
   d. Configure schedule (suggested: weekday mornings)
   e. Optional: connect Slack/email for notifications
4. Agent runs first scan — shows inbox summary + pending invitations
5. User reviews and approves first batch (builds trust)
```

### 6.2 Daily User Experience

**Morning (automated, 9:00 AM):**
- Agent auto-accepts high-confidence invitations
- Queues borderline invitations for review
- Scans feed for watchlist activity
- Checks inbox for new messages

**Morning (user, ~10 min):**
- Reviews notification/digest (Slack, email, or dashboard)
- Approves/rejects queued invitations
- Reviews and sends drafted inbox replies
- Glances at feed digest, engages with 1-2 posts

**Throughout the day (automated):**
- Follow-up sequences send on schedule
- New connection acceptances trigger sequence enrollment
- Inbox scanned again at 2:00 PM

**Weekly (user, ~15 min):**
- Reviews analytics dashboard
- Adjusts watchlist
- Tunes trust levels based on experience

### 6.3 Notification Channels

| Channel | Use Case | Priority |
|---|---|---|
| **Dashboard** (web UI) | Full analytics, review queues, settings | Primary |
| **Chrome extension popup** | Quick stats, manual overrides | Secondary |
| **Slack** | Digests, alerts, approvals | Optional |
| **Email** | Daily digest summary | Optional |

---

## 7. Data Model

### 7.1 Core Entities

```sql
-- Connections tracked by the agent
connections (
    id              INTEGER PRIMARY KEY,
    linkedin_url    TEXT UNIQUE,
    name            TEXT,
    headline        TEXT,
    company         TEXT,
    title           TEXT,
    tags            TEXT,           -- JSON array
    score           INTEGER,        -- 0-100 AI score
    score_reasoning TEXT,
    status          TEXT,           -- pending | accepted | denied | connected | ignored
    source          TEXT,           -- inbound_invitation | outbound_search | manual
    first_seen      DATETIME,
    acted_on        DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Follow-up sequence state
sequences (
    id              INTEGER PRIMARY KEY,
    connection_id   INTEGER REFERENCES connections(id),
    template        TEXT,           -- sales | recruiting | networking | custom
    status          TEXT,           -- active | paused | completed | replied
    current_step    INTEGER DEFAULT 0,
    next_send_at    DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Individual messages (sent and drafted)
messages (
    id              INTEGER PRIMARY KEY,
    connection_id   INTEGER REFERENCES connections(id),
    sequence_id     INTEGER REFERENCES sequences(id),
    direction       TEXT,           -- inbound | outbound
    content         TEXT,
    draft_options   TEXT,           -- JSON array of draft alternatives
    status          TEXT,           -- draft | approved | sent | received
    sent_at         DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Watchlist for feed monitoring
watchlist (
    id              INTEGER PRIMARY KEY,
    linkedin_url    TEXT UNIQUE,
    name            TEXT,
    tags            TEXT,           -- JSON array
    monitor_posts   BOOLEAN DEFAULT 1,
    monitor_changes BOOLEAN DEFAULT 1,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- Feed activity captured
feed_activity (
    id              INTEGER PRIMARY KEY,
    watchlist_id    INTEGER REFERENCES watchlist(id),
    activity_type   TEXT,           -- post | job_change | article | comment
    content_summary TEXT,
    engagement      TEXT,           -- JSON: {likes, comments, shares}
    suggested_action TEXT,
    captured_at     DATETIME,
    acted_on        BOOLEAN DEFAULT 0
)

-- All agent actions logged
activity_log (
    id              INTEGER PRIMARY KEY,
    action_type     TEXT,           -- accept | deny | connect | message | scan
    target_url      TEXT,
    details         TEXT,           -- JSON
    outcome         TEXT,           -- success | failed | skipped | security_block
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

---

## 8. API & Integration Points

### 8.1 Claude API Usage

| Call Type | Model | Input | Output | Est. Cost/Call |
|---|---|---|---|---|
| Invitation scoring (batch of 10) | Haiku | Profile summaries + user goals | Scores + reasoning | ~$0.002 |
| Connection note drafting | Sonnet | Profile + goal template | 1-3 draft notes | ~$0.005 |
| Follow-up message drafting | Sonnet | Profile + conversation history + template | Personalized message | ~$0.008 |
| Inbox classification (batch of 20) | Haiku | Message previews | Priority + intent labels | ~$0.003 |
| Reply drafting | Sonnet | Full conversation + user context | 2-3 reply options | ~$0.01 |
| Feed summarization | Haiku | Post content + watchlist tags | Digest with suggestions | ~$0.005 |

**Estimated daily cost per user:** $0.05 - $0.15 (moderate usage)

### 8.2 External Integrations (Phase 2+)

| Integration | Purpose | Priority |
|---|---|---|
| Slack | Notifications, digests, approval workflows | P1 |
| Email (SMTP) | Digest delivery | P2 |
| CRM (HubSpot, Salesforce) | Sync connection status and notes | P3 |
| Zapier/Make | User-defined automations | P3 |

---

## 9. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| **Connection acceptance rate** | > 40% (vs. ~15% for generic bulk) | Accepted / sent over 30 days |
| **Reply rate on follow-ups** | > 15% | Replies received / sequences completed |
| **Daily user time on LinkedIn** | < 15 min for equivalent output | Self-reported + session tracking |
| **Invitation processing accuracy** | > 90% alignment with user preferences | User override rate on agent decisions |
| **User retention (weekly active)** | > 70% at 30 days | Dashboard/digest engagement |
| **Messages drafted vs. sent as-is** | > 50% sent without edits | Edit tracking on drafts |

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LinkedIn detects automation, restricts account | Medium | High | Human-like timing patterns, conservative defaults, configurable daily caps, immediate pause on security detection |
| LinkedIn DOM changes break selectors | High | Medium | Multi-strategy selectors, automated selector health checks, rapid patch release process |
| LLM generates inappropriate messages | Low | High | All messages reviewed before send (default). Tone guidelines in system prompts. User feedback loop |
| Users over-automate, damage their reputation | Medium | Medium | Conservative default trust levels. Daily activity caps. Onboarding education on best practices |
| Cookie/session management breaks | Medium | Medium | Clear re-auth flow. Session health checks before every run. Notify user immediately on expiry |
| Cost of LLM calls at scale | Low | Low | Haiku for classification/scoring, Sonnet only for writing. Batch calls. Local model option for power users |

---

## 11. Release Plan

| Phase | Timeline | Deliverables | Success Gate |
|---|---|---|---|
| **Phase 1: Foundation** | Weeks 1-4 | Agent server, session management, scheduled auto-accept, activity logging, basic CLI | Agent can run daily auto-accept for 1 week without manual intervention |
| **Phase 2: Smart Networking** | Weeks 5-8 | Connection scoring, personalized notes, follow-up sequences, trust levels, web dashboard | Acceptance rate > 35% in pilot group |
| **Phase 3: Inbox Copilot** | Weeks 9-12 | Inbox scanner, message classification, reply drafting, inbox digest | Users process inbox in < 5 min/day |
| **Phase 4: Feed Intelligence** | Weeks 13-16 | Watchlist management, feed scanner, activity digests, suggested engagement | Users engage with 3+ watchlist contacts/week |
| **Phase 5: Integrations** | Weeks 17-20 | Slack notifications, email digests, CRM sync, mobile-friendly dashboard | 30% of users connect at least one integration |

---

## 12. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Should we offer a cloud-hosted version (managed Playwright sessions) or stay local-only? | Product | Open |
| 2 | What is the right default trust level? Conservative (review everything) may reduce activation. | Product | Open |
| 3 | Should we support LinkedIn Sales Navigator in addition to standard LinkedIn? | Engineering | Open |
| 4 | How do we handle multi-language profiles and messages? | Engineering | Open |
| 5 | Do we need a mobile companion app, or is Slack/email notification sufficient? | Product | Open |
| 6 | What is the pricing model? Free tier + paid Autopilot? Usage-based on LLM calls? | Business | Open |
| 7 | Should feed engagement (commenting on posts) ever be auto-sent, or always require approval? | Product | Open |

---

## Appendix A: Competitive Landscape

| Product | What It Does | FusenLink Autopilot Differentiation |
|---|---|---|
| **Dux-Soup** | Chrome extension, bulk visit/connect/message | No AI. Fixed templates. No feed monitoring |
| **Expandi** | Cloud-based LinkedIn automation | Cloud-only (security concerns). Basic personalization via variables, not LLM |
| **Phantombuster** | Multi-platform scraping & automation | Developer-focused. No AI messaging. No inbox management |
| **LinkedIn Sales Navigator** | Advanced search & lead management | First-party but no automation. No AI drafting. Expensive ($100+/mo) |
| **Clay** | Data enrichment + outreach | Email-focused. LinkedIn is secondary. Expensive |

**FusenLink Autopilot's moat:** Local-first (no credential risk), LLM-native (real personalization, not mail-merge), full-lifecycle (discover → connect → nurture → engage), and built on an existing working extension with proven LinkedIn DOM handling.

---

## Appendix B: Example Agent Prompts

### Invitation Scoring Prompt

```
You are evaluating LinkedIn connection invitations for a user.

USER PROFILE:
{user_profile_summary}

USER NETWORKING GOALS:
{user_goals}

INVITATIONS TO EVALUATE:
{invitation_batch}

For each invitation, return:
- score (0-100): relevance to user's goals
- action: "accept" | "review" | "deny"
- reasoning: one sentence explaining the score

Score guidelines:
- 80-100: Strong match to goals, clear mutual value
- 50-79: Partial match, worth reviewing
- 20-49: Weak relevance, likely not valuable
- 0-19: Spam, irrelevant, or suspicious profile
```

### Connection Note Drafting Prompt

```
Draft a LinkedIn connection request note (max 300 characters).

SENDER (your user):
{user_profile}

RECIPIENT:
{recipient_profile}

GOAL: {goal_template}

Rules:
- Reference something specific from the recipient's profile
- Be genuine and human — no corporate jargon
- Include a soft reason for connecting
- Stay under 300 characters including spaces
- Do NOT use phrases like "I came across your profile"

Return 3 options ranked by quality.
```

---

*This is a living document. Last updated: 2026-03-18.*
