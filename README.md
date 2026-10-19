# MailPilot AI

Production-oriented AI email generation, review, approval and Gmail delivery platform.

MailPilot AI accepts an Excel or CSV file of recipients, generates an individual email for each eligible recipient, humanizes it, performs six independent AI quality checks (four Grok reviewers + two Gemini QA), revises failures, queues the resulting emails for approval, and sends only when delivery conditions are satisfied.

## Repository layout

```
mailpilot-ai/
├── apps/
│   ├── web/         # Next.js 15 App Router (dashboard, editor, approvals, settings)
│   └── worker/      # Standalone Node.js + BullMQ worker process
├── packages/
│   ├── shared/      # Types, Zod schemas, enums, state machine
│   └── server-core/ # DB, storage, AI providers, prompts, Gmail, workflow, queues
├── supabase/migrations/  # 0001–0006 SQL migrations
├── scripts/         # check-env, seed-prompts, verify-deployment
└── tests/           # vitest unit/integration + playwright e2e
```

## Two independent processes

```bash
pnpm install
pnpm db:migrate          # apply supabase migrations
pnpm seed-prompts        # seed built-in prompts into prompt_versions
pnpm check-env           # validate env vars
pnpm dev:web             # Next.js dev server on :3000
pnpm dev:worker          # Worker process (BullMQ workers + health on :7070)
```

The worker exposes `/healthz` and `/readyz` on port 7070 for liveness probes.

## Environment variables

Copy `.env.example` to `.env` and fill in. Either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase's newer name) or `NEXT_PUBLIC_SUPABASE_ANON_KEY` (conventional name) is accepted.

Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `TOKEN_ENCRYPTION_KEY` (≥32 bytes), `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`.

Optional (slots can be configured later): `GEMINI_API_KEY_1..4`, `XAI_API_KEY_1..4`.

**Server-only.** Never put provider keys, encryption keys, the Supabase service-role key, or Gmail refresh tokens in `NEXT_PUBLIC_*` variables.

## Architecture highlights (post-review fixes)

### Security
- **Admin role**: first user to sign up is auto-promoted to admin via the `promote_first_admin()` SQL trigger. Global settings (delivery switch, provider config, prompt overrides) require admin via `requireAdmin()`.
- **Ownership filtering**: every API route and page that reads tickets / campaigns / files / events joins through `campaigns.owner_id` and filters server-side. The service-role Supabase client bypasses RLS, so manual filtering is enforced everywhere.
- **Auth middleware**: `src/middleware.ts` protects all routes except `/login`, `/api/health`, and the OAuth callback. Unauthenticated API requests get 401 JSON; unauthenticated page requests redirect to `/login?next=...`.
- **Approval gate on drafts**: `POST /api/gmail/draft` and `draft.processor.ts` require `approval_status === "approved"` and `current_state ∈ {approved, ready_to_send, gmail_draft_created}` — same as the send path.
- **Atomic send reservation**: `reserve_ticket_for_send()` Postgres function atomically transitions `ready_to_send|approved|gmail_draft_created → sending` only if the ticket is still in one of those states. Two simultaneous callers race; only one wins. The `operation_id` is deterministic (`${ticketId}:${versionId}`) so retries collapse to the same row.
- **State-machine enforcement**: revision and reject routes use `transitionTicket()` with optimistic concurrency. Illegal transitions are rejected at the API layer.

### Pipeline wiring
- **Start actually starts**: `POST /api/campaigns/:id/start` enqueues every queued ticket for analysis via `enqueueIdempotent(QUEUE_NAMES.analysis, "analyze", ...)`.
- **Orchestrator**: `apps/worker/src/services/workflow-orchestrator.ts` is the single source of truth for advancing a ticket through stages. Every processor calls `orchestrate(ticketId)` after its transition to enqueue the next stage.
- **Completion tracker**: `apps/worker/src/services/completion-tracker.ts` waits for ALL required reviews (4 Grok + 2 Gemini QA) before transitioning `grok_reviews → gemini_qa → quality_gate`. Eliminates the race where the gate runs before reviews are written.
- **Quality gate**: requires non-empty review set AND every required reviewer to have `decision = "pass"` and `status = "completed"`. Missing reviews → `needs_attention`. Empty `required_reviewers` defaults to the full 6-reviewer set.
- **Recovery sweep**: on worker startup, stuck tickets are reset and re-enqueued via the orchestrator (not just state-reset).
- **Retry-safe processors**: every processor uses `atomic_transition_ticket` for its initial state transition. If a BullMQ retry re-runs the job, the transition returns NULL (ticket is no longer in the expected state) and the processor no-ops.

### Providers
- **JSON mode**: Gemini requests `responseMimeType: "application/json"`. Grok sends `response_format: { type: "json_object" }`.
- **Real timeouts**: Gemini uses `Promise.race` against a timeout; Grok uses `AbortSignal.timeout()`.
- **Parse failures are errors**: a non-JSON provider response is recorded as `decision = "error"`, `status = "failed"`, `error_code = "PARSE_ERROR"` — distinct from a legitimate `revise` decision. The quality gate treats errored reviews as failures requiring human attention.

### HTML sanitization
- AI-generated HTML is sanitized via `sanitizeHtml()` before persistence (in `generate.processor.ts`, `humanize.processor.ts`, `revise.processor.ts`).
- The sanitizer strips `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, all `on*` event handlers, `javascript:` URLs, and unknown tags. For production-grade sanitization of user-supplied HTML, use DOMPurify on the server.

### Gmail
- **4xx vs 5xx**: 4xx responses (401, 400, 413, 403) are definitive failures — ticket goes to `needs_attention`. 5xx and network timeouts are `send_status_unknown` and require reconciliation.
- **Multi-account safe**: `getValidAccessToken()` uses `.order().limit(1)` instead of `.maybeSingle()` so users with multiple connected Gmail accounts don't error.
- **Drafts are not sends**: `send_operations` rows for drafts use `status = "unknown"` (not `"sent"`) so they're not counted as deliveries.

### Schema
- **Idempotent tickets**: `tickets(campaign_id, contact_id)` UNIQUE constraint. Re-importing the same spreadsheet does not create duplicate tickets.
- **Auto-profile creation**: trigger on `auth.users` creates a `profiles` row on signup. First user becomes admin.
- **Transactional settings**: `update_campaign_settings()` Postgres function updates JSON + bumps version in one transaction.
- **Delivery caps helper**: `count_recent_sends(campaign_id, window_seconds)` enforces `max_per_hour` and `max_per_day`.

## AI slots (eight total)

| Slot | Provider | Purpose |
|---|---|---|
| `gemini_analyze` | Gemini | Campaign brief & recipient analysis |
| `gemini_generate` | Gemini | Initial draft + revisions |
| `gemini_qa_structure` | Gemini | Required-sections / format check |
| `gemini_qa_personalization` | Gemini | Recipient accuracy / source-grounding check |
| `grok_defensibility` | Grok | Factual & reputational review |
| `grok_human_tone` | Grok | Natural-language quality review |
| `grok_content_fit` | Grok | Campaign relevance review |
| `grok_delivery_hygiene` | Grok | Email content & compliance review |

Plus a mandatory `humanizer` pass that runs on every version eligible for delivery.

## Workflow state machine

```
queued → analyzing → drafting → humanizing → grok_reviews → gemini_qa → quality_gate
                                                              ├── failed → revising → humanizing → re-review (max 3 cycles)
                                                              ├── unresolved → needs_attention
                                                              └── passed → pending_approval → approved → ready_to_send
                                                                                                       ├── create Gmail draft → gmail_draft_created
                                                                                                       └── direct Gmail send → sending → sent (or send_status_unknown / needs_attention)
```

Every transition is persisted in PostgreSQL with optimistic concurrency via `atomic_transition_ticket()`.

## Tests

```bash
pnpm test           # vitest unit + integration (31 tests)
pnpm test:e2e       # playwright browser tests
pnpm typecheck      # tsc across all 4 workspaces
```

All four packages (`shared`, `server-core`, `web`, `worker`) typecheck cleanly. The web app builds with `next build`. 31 unit tests pass.

## Known limitations

- PDF and DOCX text extraction requires optional `pdf-parse` and `mammoth` packages. Install them in `packages/server-core` to enable; otherwise extraction is recorded as a failure with a clear message.
- Send reconciliation for `send_status_unknown` is a scaffold. A production deployment should query `gmail.users.messages.list` with the RFC822 Message-ID header to confirm delivery before allowing a re-send.
- HTML sanitization is regex-based. Suitable for AI-generated email bodies (already constrained by prompts), but for user-supplied HTML use DOMPurify via jsdom.
- The OAuth flow stores state in a 10-minute cookie. For production, persist state in a signed server-side store with replay protection.
- Rate limiting on auth endpoints and IP-based throttling on imports are not yet implemented.
