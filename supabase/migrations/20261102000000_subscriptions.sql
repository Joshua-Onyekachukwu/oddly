-- ============================================
-- SUBSCRIPTIONS & SUBSCRIPTION EVENT LEDGER
-- ============================================
-- Source-of-truth subscription state mirrored from Stripe.
-- profiles.subscription_tier / subscription_expires_at remain the
-- denormalized cache the app reads; these tables enable
-- reconciliation and a full Stripe event history.
-- ============================================

create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  tier text not null default 'free' check (tier in ('free', 'premium', 'elite')),
  status text not null default 'incomplete'
    check (status in ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscription_events (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  stripe_event_id text not null unique,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_customer_id
  on subscriptions(stripe_customer_id);
create index if not exists idx_subscriptions_status on subscriptions(status);
create index if not exists idx_subscription_events_subscription_id
  on subscription_events(subscription_id);

-- Keep updated_at fresh on subscriptions
drop trigger if exists subscriptions_updated_at on subscriptions;
create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table subscriptions enable row level security;
alter table subscription_events enable row level security;

drop policy if exists "Users read own subscriptions" on subscriptions;
drop policy if exists "Admins read all subscriptions" on subscriptions;
drop policy if exists "Service role manages subscriptions" on subscriptions;

create policy "Users read own subscriptions" on subscriptions
  for select using (auth.uid() = user_id);

create policy "Admins read all subscriptions" on subscriptions
  for select using (public.is_admin());

create policy "Service role manages subscriptions" on subscriptions
  for all using (public.is_service_role());

drop policy if exists "Users read own subscription events" on subscription_events;
drop policy if exists "Admins read all subscription events" on subscription_events;
drop policy if exists "Service role manages subscription events" on subscription_events;

create policy "Users read own subscription events" on subscription_events
  for select using (
    exists (
      select 1 from subscriptions s
      where s.id = subscription_events.subscription_id
        and s.user_id = auth.uid()
    )
  );

create policy "Admins read all subscription events" on subscription_events
  for select using (public.is_admin());

create policy "Service role manages subscription events" on subscription_events
  for all using (public.is_service_role());

alter table subscriptions force row level security;
alter table subscription_events force row level security;
