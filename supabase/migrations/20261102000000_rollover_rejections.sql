-- ============================================
-- ROLLOVER REJECTED-OPPORTUNITY LOG (spec §6)
-- ============================================
-- Auditable record of candidates the rollover engine evaluated and
-- rejected on each run, so filter quality can be reviewed over time
-- ("are we rejecting too much or too little?").
--
-- Written by /api/v1/rollover/recommendation via the service role
-- (bypasses RLS). Admins may read for audit; regular users cannot.

create table if not exists rollover_rejections (
  id uuid primary key default uuid_generate_v4(),
  fixture_id text,
  market text,
  selection text,
  model_probability numeric,
  reason_code text,
  detail jsonb,
  evaluated_at timestamptz not null default now()
);

comment on table rollover_rejections is
  'Rejected rollover-engine candidates per evaluation run (audit log, spec §6)';
comment on column rollover_rejections.reason_code is
  'Primary rejection reason code (first engine reason, before any :)';
comment on column rollover_rejections.detail is
  'Full reasons array plus odds/bookmaker/league context for the candidate';

create index if not exists idx_rollover_rejections_evaluated_at
  on rollover_rejections(evaluated_at desc);
create index if not exists idx_rollover_rejections_fixture
  on rollover_rejections(fixture_id);

alter table rollover_rejections enable row level security;

-- Service role bypasses RLS for inserts. Only admins may read.
create policy "Admins can read rollover rejections" on rollover_rejections
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
