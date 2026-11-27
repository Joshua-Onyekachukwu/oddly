-- Provider namespacing for fixtures + league external-id mapping
--
-- Problems addressed:
--   * fixtures.external_id had no provider namespace — The Odds API hex ids
--     and API-Football numeric ids could collide.
--   * leagues had no way to map provider league ids (API-Football league.id,
--     The Odds API sport_key, football-data.co.uk codes) to league rows, so
--     name-exact matching created duplicates / NULL league_id fixtures.
--
-- Least-invasive design:
--   * fixtures.provider text column (nullable; sync writers set it explicitly)
--   * league_external_ids mapping table (league can have many provider ids)
--   * 7 new league rows for football-data.co.uk second/third divisions that
--     have real backfill data (E2/E3/D2/I2/SP2/F2/B1)

-- ============================================
-- 1. fixtures.provider
-- ============================================

alter table fixtures add column if not exists provider text;

-- Composite uniqueness: same external_id is only unique within a provider.
-- Partial index so legacy NULL-provider rows don't block it.
create unique index if not exists fixtures_provider_external_id_key
  on fixtures (provider, external_id)
  where provider is not null and external_id is not null;

-- Backfill provider where derivable:
--   'rd:<idx>'            → research-dataset backfill (football-data.co.uk)
--   32-char lowercase hex → The Odds API fixture ids
update fixtures
  set provider = 'backfill'
  where provider is null and external_id like 'rd:%';

update fixtures
  set provider = 'the-odds-api'
  where provider is null and external_id ~ '^[0-9a-f]{32}$';

-- Remaining rows keep provider NULL (unknown provenance) rather than being
-- mislabeled. Sync writers always set provider explicitly going forward.

-- ============================================
-- 2. league_external_ids mapping table
-- ============================================

create table if not exists league_external_ids (
  league_id uuid not null references leagues(id) on delete cascade,
  provider text not null,
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (provider, external_id)
);

create index if not exists league_external_ids_league_idx
  on league_external_ids (league_id);

alter table league_external_ids enable row level security;

drop policy if exists "Anyone can view league external ids" on league_external_ids;
create policy "Anyone can view league external ids" on league_external_ids
  for select using (true);

drop policy if exists "Admins can manage league external ids" on league_external_ids;
create policy "Admins can manage league external ids" on league_external_ids
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

grant select on league_external_ids to anon;
grant all on league_external_ids to service_role;

-- ============================================
-- 3. New league rows for unmapped football-data.co.uk codes
--    (only leagues with real backfill data — see data/research-dataset.json)
-- ============================================

insert into leagues (name, country, sport, is_active, priority)
select v.name, v.country, 'football', true, 5
from (values
  ('League One',          'England'),
  ('League Two',          'England'),
  ('2. Bundesliga',       'Germany'),
  ('LaLiga2',             'Spain'),
  ('Serie B',             'Italy'),
  ('Ligue 2',             'France'),
  ('Belgian Pro League',  'Belgium')
) as v(name, country)
where not exists (
  select 1 from leagues l where lower(l.name) = lower(v.name)
);

-- ============================================
-- 4. Seed provider → league mappings
-- ============================================

insert into league_external_ids (league_id, provider, external_id)
select l.id, m.provider, m.external_id
from (values
  -- football-data.co.uk competition codes (research-dataset backfill)
  ('Premier League',         'football-data-co-uk', 'E0'),
  ('Championship',           'football-data-co-uk', 'E1'),
  ('League One',             'football-data-co-uk', 'E2'),
  ('League Two',             'football-data-co-uk', 'E3'),
  ('Scottish Premiership',   'football-data-co-uk', 'SC0'),
  ('Bundesliga',             'football-data-co-uk', 'D1'),
  ('2. Bundesliga',          'football-data-co-uk', 'D2'),
  ('Serie A',                'football-data-co-uk', 'I1'),
  ('Serie B',                'football-data-co-uk', 'I2'),
  ('La Liga',                'football-data-co-uk', 'SP1'),
  ('LaLiga2',                'football-data-co-uk', 'SP2'),
  ('Ligue 1',                'football-data-co-uk', 'F1'),
  ('Ligue 2',                'football-data-co-uk', 'F2'),
  ('Eredivisie',             'football-data-co-uk', 'N1'),
  ('Primeira Liga',          'football-data-co-uk', 'P1'),
  ('Super Lig',              'football-data-co-uk', 'T1'),
  ('Belgian Pro League',     'football-data-co-uk', 'B1'),

  -- API-Football league ids (api-sports.io v3)
  ('Premier League',         'api-football', '39'),
  ('Championship',           'api-football', '40'),
  ('League One',             'api-football', '41'),
  ('League Two',             'api-football', '42'),
  ('La Liga',                'api-football', '140'),
  ('LaLiga2',                'api-football', '141'),
  ('Bundesliga',             'api-football', '78'),
  ('2. Bundesliga',          'api-football', '79'),
  ('Serie A',                'api-football', '135'),
  ('Serie B',                'api-football', '136'),
  ('Ligue 1',                'api-football', '61'),
  ('Ligue 2',                'api-football', '62'),
  ('Eredivisie',             'api-football', '88'),
  ('Primeira Liga',          'api-football', '94'),
  ('NPFL',                   'api-football', '168'),
  ('Brasileirão',            'api-football', '71'),
  ('MLS',                    'api-football', '253'),
  ('Champions League',       'api-football', '2'),
  ('Belgian Pro League',     'api-football', '144'),

  -- The Odds API sport keys (the-odds-api.com v4)
  ('Premier League',         'the-odds-api', 'soccer_epl'),
  ('La Liga',                'the-odds-api', 'soccer_spain_la_liga'),
  ('Bundesliga',             'the-odds-api', 'soccer_germany_bundesliga'),
  ('Serie A',                'the-odds-api', 'soccer_italy_serie_a'),
  ('Ligue 1',                'the-odds-api', 'soccer_france_ligue_one'),
  ('Eredivisie',             'the-odds-api', 'soccer_netherlands_eredivisie'),
  ('Primeira Liga',          'the-odds-api', 'soccer_portugal_primeira_liga'),
  ('Brasileirão',            'the-odds-api', 'soccer_brazil_campeonato'),
  ('MLS',                    'the-odds-api', 'soccer_usa_mls'),
  ('Champions League',       'the-odds-api', 'soccer_uefa_champs_league')
) as m(league_name, provider, external_id)
join leagues l on lower(l.name) = lower(m.league_name)
on conflict (provider, external_id) do nothing;
