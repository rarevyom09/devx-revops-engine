-- Automation switches and in-platform notifications.
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
insert into app_settings (key, value) values
  ('auto_analyse', 'true'),
  ('auto_brief', 'true'),
  ('ai_reserve', '5')            -- automation stops when this many AI calls are left
on conflict (key) do nothing;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ai_analysed','ai_failed','brief_drafted','leak')),
  severity text not null default 'info' check (severity in ('critical','warning','info')),
  title text not null,
  body text,
  href text,
  owner_id uuid references people(id) on delete set null,
  dedupe_key text unique,         -- one notification per leak / event
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists notifications_created on notifications (created_at desc);
notify pgrst, 'reload schema';
