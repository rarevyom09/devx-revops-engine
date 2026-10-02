# Revenue Ops Engine (Devx Labs case)

Deal → booking → invoice → realization → margin, with AI on a leash.
See `HANDOFF.md` for the full design and `FAKED.md` for what is simulated.

## Setup

1. Create a Supabase project (free tier) and an Anthropic API key.
2. Fill in `.env.local` (template: `.env.example`).
3. `npm install && npm run db:setup` creates all tables (destructive: drops and recreates). Then apply migrations: `npm run db:sql supabase/002_ai_calls.sql` and `npm run db:sql supabase/003_rep_answers.sql` and `npm run db:sql supabase/004_automation.sql` (needs `SUPABASE_ACCESS_TOKEN`), or paste them into the Supabase SQL editor.
4. `npm run dev`, open http://localhost:3000/ingest and click **Load demo data**.

## Build status

| Step | Module | Status |
|---|---|---|
| 1 | Schema + seed | done |
| 2 | Ingest tab (paste / CSV / quick form, demo seed/reset, row counts) | done |
| 3 | Deal Integrity Agent (AI) | done (validator tests: `npx tsx scripts/test-integrity.ts`) |
| 4 | Onboarding Orchestrator (AI) | done (tests: `npx tsx scripts/test-onboarding.ts`) |
| 5 | Clawback (rules) | done (tests: `npx tsx scripts/test-rules.ts`) |
| 6 | Revenue Flow home + Honesty | done |
| 7 | Margin (rules) | done |
| + | Leak engine + exceptions inbox (home) | done (tests: `npx tsx scripts/test-leaks.ts`) |
| + | Dashboard: 9 charts with as-of time machine and filters (`/dashboard`) | done |
| + | Try cases: 6 runnable scenarios with live checklists (`/cases`) | done |
| + | Passcode lock (`DEMO_PASSCODE`), AI-calls-left meter, display currency INR/SGD/USD | done |
| + | Automation: auto-analyse on ingest, auto-brief on approval, leak scan → in-app notifications (`supabase/004_automation.sql`) | done |
| + | AI call cap (50, `ai_calls` ledger; run `supabase/002_ai_calls.sql`) | done |
