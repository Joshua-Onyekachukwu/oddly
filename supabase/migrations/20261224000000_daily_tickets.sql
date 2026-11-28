-- Daily "Ticket of the Day": one high-confidence multi-leg accumulator
-- recommendation per UTC day, persisted for honest track-record keeping.
--
-- Written by GET /api/v1/ticket-of-the-day (src/app/api/v1/ticket-of-the-day/
-- route.ts) via src/lib/tickets/ticket-of-day.ts on top of the rollover
-- engine. Abstained days are persisted too (status='abstained', legs=[]) so
-- the public track record includes honest "no ticket" days.
--
-- Settlement: src/app/api/v1/cron/settle settles result='pending' rows once
-- every leg's fixture is finished. Sports data only — public read, writes
-- service-role only (same pattern as 20261222000000_public_read_policies.sql).

create table if not exists daily_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_date date not null,
  status text not null check (status in ('qualified', 'abstained')),
  legs jsonb not null default '[]',
  combined_odds numeric,
  combined_probability numeric,
  combined_ev numeric,
  leg_count integer,
  decision_reason text,
  closest_miss jsonb,
  result text not null default 'pending'
    check (result in ('pending', 'won', 'lost', 'void', 'partial')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_date)
);

comment on table daily_tickets is
  'One ticket-of-the-day row per UTC date (qualified or honest abstention). Settled by cron/settle for the public track record.';
comment on column daily_tickets.legs is
  'Array of {fixtureId, fixtureLabel, kickoffTime, market, selection, modelProbability, odds, bookmaker, predictionId}. Empty on abstained days.';
comment on column daily_tickets.combined_probability is
  'Correlation-adjusted joint probability used for gating (engine adjustedProbability).';
comment on column daily_tickets.combined_ev is
  'Correlation-aware EV (engine adjustedEv) — reported honestly even when negative.';
comment on column daily_tickets.closest_miss is
  'On abstained days: best near-miss combination and which gate it failed.';

create index if not exists idx_daily_tickets_date on daily_tickets (ticket_date desc);
create index if not exists idx_daily_tickets_result on daily_tickets (result);

alter table daily_tickets enable row level security;

-- Public read: sports data, same pattern as the public_read_policies
-- migration. No INSERT/UPDATE/DELETE policies — writes are service-role only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'daily_tickets' and policyname = 'Public read daily tickets'
  ) then
    create policy "Public read daily tickets" on daily_tickets
      for select to anon, authenticated using (true);
  end if;
end $$;
