-- AI call budget ledger. One row per Claude API call attempt.
-- The app refuses to call Claude once the row count reaches AI_CALL_LIMIT (default 50).
-- Not touched by "Reset demo", so the budget can't be reset by accident.
create table if not exists ai_calls (
  id uuid primary key default gen_random_uuid(),
  route text not null,                 -- e.g. pipeline.analyse, onboarding.draft
  model text not null,
  status text not null default 'reserved' check (status in ('reserved','ok','failed')),
  input_tokens int,
  output_tokens int,
  detail text,
  created_at timestamptz default now()
);
notify pgrst, 'reload schema';
