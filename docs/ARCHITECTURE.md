# ODDLY — Hybrid Architecture Documentation

## Architecture Overview

```
                    Vercel (Application / API)
                      │
                Application/API Layer
                      │
          ┌───────────┴───────────┐
          ↓                       ↓
      Supabase               CockroachDB
   Operational Data       Historical/Cold Data
   (500MB free)           (10GB free)
          │                       │
          │                       ↓
          │               Processing Workers
          │                       │
          │                       ↓
          │               ML/Training Pipeline
          │                       │
          │                       ↓
          │               Model Artifacts
          │                       │
          ↓                       ↓
    User-Facing UI         Analytics Dashboard
```

## Data Ownership Matrix

| Dataset | Supabase | CockroachDB | Source of Truth |
|---------|----------|-------------|-----------------|
| Users & Auth | ✓ | | Supabase |
| Active Predictions | ✓ | | Supabase |
| Historical Predictions | Archive | ✓ | CockroachDB |
| Historical Fixtures | Archive | ✓ | CockroachDB |
| Historical Odds | Archive | ✓ | CockroachDB |
| xG Features | | ✓ | CockroachDB |
| Referee Profiles | | ✓ | CockroachDB |
| Training Data | | ✓ | CockroachDB |
| League Models | | ✓ | CockroachDB |
| Odds Snapshots | ✓ | | Supabase |
| User Accumulators | ✓ | | Supabase |
| Model Performance | ✓ | | Supabase |

## Supabase Responsibilities

- **Authentication**: User sign-up, sign-in, session management
- **Real-time**: Live prediction updates, match status changes
- **Operational Data**: Active predictions, accumulators, user tracking
- **API Responses**: Fast reads for the frontend
- **Row-Level Security**: User data isolation

## CockroachDB Responsibilities

- **Historical Data**: All settled predictions (599K+)
- **Cold Storage**: Old fixtures, odds snapshots
- **ML Training**: Training datasets, feature stores
- **Analytics**: Aggregated statistics, calibration data
- **Large Queries**: Complex analytical queries that would timeout on Supabase
- **10GB Capacity**: 20x more headroom than Supabase free tier

## Worker/Compute Layer

Heavy processing runs as Node.js workers that read from CockroachDB:

- **Ensemble Model**: Reads training data from CockroachDB
- **Settlement Engine**: Archives settled predictions to CockroachDB
- **Prediction Pipeline**: Generates predictions, writes to Supabase
- **Data Collection**: Scrapes data, writes to appropriate database

## Environment Variables

### Vercel (Application)

```
# Required - Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Required - CockroachDB
COCKROACHDB_URL=postgresql://Oddly:xxx@xxx.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full

# Optional - APIs
THE_ODDS_API_KEY=xxx
API_FOOTBALL_KEY=xxx
```

### What NOT to expose to browser

- `SUPABASE_SERVICE_ROLE_KEY` — server-side only
- `COCKROACHDB_URL` — server-side only
- `THE_ODDS_API_KEY` — server-side only
- `API_FOOTBALL_KEY` — server-side only

## CockroachDB Configuration

### Connection Details

- **Cluster**: `new-ray-32596.j77.aws-eu-central-1.cockroachlabs.cloud`
- **Port**: `26257`
- **Database**: `defaultdb`
- **User**: `Oddly`
- **SSL**: Required (`sslmode=verify-full`)
- **Certificate**: `~/.postgresql/root.crt`

### Tables

| Table | Rows | Purpose |
|-------|------|---------|
| cockroach_leagues | 79 | League reference data |
| cockroach_teams | 838 | Team reference data |
| cockroach_fixtures | 13,986 | Historical fixtures |
| cockroach_predictions | 594,000+ | All predictions (cold storage) |
| cockroach_xg_features | 831 | Understat xG per team |
| cockroach_referee_profiles | 113 | Referee statistics |

### Indexes

```sql
CREATE INDEX idx_cr_preds_market ON cockroach_predictions(market);
CREATE INDEX idx_cr_preds_result ON cockroach_predictions(result);
CREATE INDEX idx_cr_preds_created ON cockroach_predictions(created_at);
CREATE INDEX idx_cr_preds_fixture ON cockroach_predictions(fixture_id);
CREATE INDEX idx_cr_fixtures_kickoff ON cockroach_fixtures(kickoff_time);
CREATE INDEX idx_cr_xg_team ON cockroach_xg_features(team_name);
```

## Synchronization Strategy

### Direction: Supabase → CockroachDB

Data flows from Supabase to CockroachDB for archival. Never the reverse for operational data.

### Triggers

1. **Settlement**: After predictions are settled in Supabase, archive to CockroachDB
2. **Daily Cron**: Sync new fixtures and predictions
3. **On-Demand**: Migration script for bulk historical data

### Failure Handling

- Archival failures are logged but don't block settlement
- Retry with exponential backoff (3 retries)
- Idempotent: re-running archive skips existing IDs
- All operations tracked with correlation IDs

## Rollback Strategy

If CockroachDB becomes unavailable:

1. **Application**: Continues working — Supabase handles all user-facing queries
2. **Prediction Engine**: Falls back to local JSON files for training data
3. **Settlement**: Predictions still settle in Supabase; archival retries later
4. **Analytics**: Dashboard shows "CockroachDB unavailable" — no crash

To fully rollback:
1. Remove `COCKROACHDB_URL` from environment
2. Application degrades gracefully (no CockroachDB features)
3. All data remains in Supabase

## Monitoring

### API Endpoints

- `GET /api/v1/admin/db-health` — Database comparison dashboard
- `GET /api/v1/admin/model-performance` — Model accuracy tracking

### Key Metrics

- Supabase query latency
- CockroachDB query latency
- Migration progress (% complete)
- Archive success/failure rate
- Training data extraction time
- Settlement processing time
