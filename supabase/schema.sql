-- Revenue Operations Engine schema (Devx Labs case)
-- Run once in the Supabase SQL editor. Safe to re-run: drops and recreates.
-- RLS is intentionally OFF (single-user demo). All writes go through server
-- route handlers with the service-role key. See FAKED.md.

drop table if exists payments, invoices, timesheets, onboarding_briefs, deals,
  deal_analyses, raw_deals, rates, people cascade;

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text check (role in ('consulting_owner','practice_lead','delivery')),
  entity text check (entity in ('IN','SG')),
  variable_pay_target numeric          -- per quarter, INR, invented
);

create table raw_deals (               -- ingestion landing table (untrusted text)
  id uuid primary key default gen_random_uuid(),
  source text check (source in ('paste','csv','form','demo')),
  raw_text text not null,
  owner_id uuid references people(id) on delete set null,
  created_at timestamptz default now(),
  status text default 'pending'
    check (status in ('pending','analysed','approved','rejected'))
);

create table deal_analyses (           -- AI output, kept for audit
  id uuid primary key default gen_random_uuid(),
  raw_deal_id uuid references raw_deals(id) on delete cascade,
  model text,
  output jsonb not null,               -- proposed records, reasoning, ambiguities
  confidence text check (confidence in ('high','medium','low')),
  validator_flags jsonb,               -- deterministic checks that failed
  created_at timestamptz default now()
);

create table deals (                   -- approved records only
  id uuid primary key default gen_random_uuid(),
  raw_deal_id uuid references raw_deals(id) on delete set null,
  name text not null unique,
  deal_type text not null check (deal_type in ('one_time','recurring')),
  amount numeric not null,             -- total for one_time; monthly for recurring
  term_months int,                     -- recurring only
  close_date date not null,
  owner_id uuid references people(id) on delete set null,
  practice_split jsonb,                -- {"AI":0.6,"Web":0.4}
  partner text,                        -- e.g. AWS
  partner_flags jsonb,                 -- co-sell, MDF, deal reg (stub)
  approved_by text,
  approved_at timestamptz,
  constraint recurring_has_term check (
    (deal_type = 'recurring' and term_months is not null and term_months > 0)
    or (deal_type = 'one_time' and term_months is null)
  )
);

create table onboarding_briefs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  brief jsonb,                         -- scope, success criteria, risks
  milestones jsonb,                    -- [{name, pct, due_date}]
  status text default 'draft' check (status in ('draft','approved')),
  approved_by text,
  approved_at timestamptz
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  milestone text not null,
  amount numeric not null check (amount > 0),
  raised_on date not null,
  owner_id uuid references people(id) on delete set null,
  variable_pay_at_stake numeric,       -- invented rule: 5% of amount
  unique (deal_id, milestone)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_on date not null
);

create table rates (
  location text primary key check (location in ('IN','SG')),
  hourly_rate numeric not null,        -- invented, INR
  currency text default 'INR'
);

create table timesheets (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references deals(id) on delete cascade,
  location text references rates(location),
  hours numeric not null check (hours > 0),
  logged_on date not null
);
