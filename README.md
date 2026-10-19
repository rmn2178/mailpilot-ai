# MailPilot AI

Production-oriented AI email generation, review, approval and Gmail delivery platform.

MailPilot AI accepts an Excel or CSV file of recipients, generates an individual email for each eligible recipient, humanizes it, performs six independent AI quality checks (four Grok reviewers + two Gemini QA), revises failures, queues the resulting emails for approval, and sends only when delivery conditions are satisfied.

## Repository layout

```
mailpilot-ai/
├── apps/
│   ├── web/              # Next.js 15 App Router (dashboard, approvals, settings)
│   └── worker/           # Standalone Node.js + BullMQ worker process
├── packages/
│   ├── shared/           # Types, Zod schemas, enums, state machine
│   └── server-core/      # DB, storage, AI providers, prompts, Gmail, workflow, queues
├── supabase/migrations/  # 0001–0010 SQL migrations
├── scripts/              # check-env, seed-prompts, verify-deployment
└── tests/                # vitest unit/integration + playwright e2e
```

## Quick start

```bash
pnpm install
pnpm dev:web        # Next.js dev server on http://localhost:3000
pnpm dev:worker     # Worker process (BullMQ + health on :7070)
```

Sign in at `http://localhost:3000/login` with the credentials set in your `.env`:

```
ADMIN_EMAIL=admin@mailpilot.ai
ADMIN_PASSWORD=admin123
```

The worker exposes `/healthz` and `/readyz` on port 7070 for liveness probes.

## Database setup

Run the combined migration in the **Supabase SQL Editor** (Dashboard → SQL Editor → New query):

```
supabase/migrations/ALL_MIGRATIONS.sql   # generated from 0001–0010
```

Or run them in order via the Supabase CLI:

```bash
pnpm db:migrate
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

### Required

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role secret key |
| `TOKEN_ENCRYPTION_KEY` | Random 32-byte hex (run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ADMIN_EMAIL` | Login email for the single admin account |
| `ADMIN_PASSWORD` | Login password for the single admin account |

### Required for Gmail sending

| Variable | Description |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud OAuth 2.0 client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud OAuth 2.0 client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | OAuth redirect URI (e.g. `http://localhost:3000/api/connections/gmail/callback`) |

### Required for the worker

| Variable | Description |
|---|---|
| `REDIS_URL` | Redis connection URL (default: `redis://localhost:6379`) |
| `GEMINI_API_KEY_1..4` | Gemini API keys (at least one required) |
| `XAI_API_KEY_1..4` | xAI/Grok API keys (at least one required) |

> **Security:** Never put provider keys, encryption keys, or the Supabase service-role key into `NEXT_PUBLIC_*` variables.

## Authentication

Authentication uses a simple cookie-based session — no Supabase Auth, no magic links. A single admin account is configured via `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. The session cookie is signed with `TOKEN_ENCRYPTION_KEY` and valid for 7 days.

## Vercel deployment

The repo includes `vercel.json` at the root. Import the repo in Vercel and add the environment variables listed above. Update `GOOGLE_OAUTH_REDIRECT_URI` to your Vercel deployment URL.

The worker is a long-running process and must be deployed separately (e.g. Railway, Render, or a VPS). It is not suitable for Vercel serverless functions.

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
                                                                  │
                                              ┌───────────────────┼────────────────────┐
                                              │                   │                    │
                                           failed            unresolved              passed
                                              │                   │                    │
                                           revising        needs_attention     pending_approval
                                              │                                         │
                                          (loops, max 3)                            approved
                                                                                        │
                                                                              ready_to_send
                                                                              ┌──────────┴──────────┐
                                                                      gmail_draft_created         sending
                                                                                                     │
                                                                                             sent / send_status_unknown
                                                                                                 / needs_attention
```

Every transition is persisted in PostgreSQL with optimistic concurrency via `atomic_transition_ticket()`.

## Architecture highlights

### Security
- **Cookie auth**: middleware validates a signed `mp_session` cookie on every request. Unauthenticated API requests get 401 JSON; page requests redirect to `/login?next=...`.
- **Ownership filtering**: every API route joins through `campaigns.owner_id` server-side. The service-role Supabase client bypasses RLS — manual ownership checks are enforced everywhere.
- **Approval gate**: `POST /api/gmail/draft` and the send path both require `approval_status === "approved"`.
- **Atomic send reservation**: `reserve_ticket_for_send()` Postgres function transitions `ready_to_send → sending` atomically. Two simultaneous callers race; only one wins.

### Pipeline
- **Orchestrator**: `workflow-orchestrator.ts` is the single source of truth for advancing tickets through stages. Every processor calls `orchestrate(ticketId)` after its transition.
- **Completion tracker**: waits for all 6 required reviews before moving to the quality gate. Eliminates the race where the gate runs before reviews are written.
- **Retry-safe processors**: every processor uses `atomic_transition_ticket` for its initial transition. BullMQ retries no-op if the ticket has already moved on.
- **Recovery sweep**: on worker startup, stuck tickets are reset and re-enqueued via the orchestrator.

### Providers
- **JSON mode**: Gemini uses `responseMimeType: "application/json"`. Grok uses `response_format: { type: "json_object" }`.
- **Real timeouts**: Gemini uses `Promise.race` against a timeout; Grok uses `AbortSignal.timeout()`.
- **Parse failures are errors**: non-JSON responses are recorded as `decision = "error"`, `status = "failed"`, `error_code = "PARSE_ERROR"` — distinct from a `revise` decision.

## Tests

```bash
pnpm test           # vitest unit + integration
pnpm test:e2e       # playwright browser tests
pnpm typecheck      # tsc across all 4 workspaces
```

## Known limitations

- PDF and DOCX text extraction requires optional `pdf-parse` and `mammoth` packages. Install them in `packages/server-core` to enable.
- Send reconciliation for `send_status_unknown` is a scaffold — a production deployment should query the Gmail API to confirm delivery.
- HTML sanitization is regex-based. Suitable for AI-generated content; for user-supplied HTML use DOMPurify.
- Rate limiting on auth and import endpoints is not yet implemented.
