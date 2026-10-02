-- Rep-in-the-loop notifications and auto-drafted follow-ups for critical leaks.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('ai_analysed','ai_failed','brief_drafted','leak','rep_question','rep_answered','draft_ready'));

create table if not exists action_drafts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  alert_id text not null unique,          -- one draft per leak
  alert_title text,
  status text not null default 'drafting' check (status in ('drafting','ready','failed','sent','dismissed')),
  assist jsonb,                           -- {situation, next_steps[], draft_message{to,subject,body}|null}
  unverified_amounts jsonb,               -- ₹ figures not found in the deal's data
  model text,
  detail text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into app_settings (key, value) values ('auto_drafts', 'true') on conflict (key) do nothing;
notify pgrst, 'reload schema';
