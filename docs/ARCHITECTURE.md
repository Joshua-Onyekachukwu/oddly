# ODDLY — Hybrid Architecture Documentation

## Architecture Overview

```
                    Vercel (Application / API)
                      |
                Application/API Layer
                      |
          +-----------+-----------+
          v                       v
      Supabase               Convex
   Operational Data       Historical/Cold Data
   (500MB free)           (Unlimited on free tier)
          |                       |
          |                       v
          |               Processing Workers
          |                       |
          |                       v
          |               ML/Training Pipeline
          |                       |
          |                       v
          |               Model Artifacts
          |                       |
          v                       v
    User-Facing UI         Analytics Dashboard
```

## Data Ownership Matrix

| Dataset | Supabase | Convex | Source of Truth |
|---------|----------|--------|-----------------|
| Users & Auth | Yes | | Supabase |
| Active Predictions | Yes | | Supabase |
| Historical Predictions | Archive | Yes | Convex |
| Historical Fixtures | Archive | Yes | Convex |
| Historical Odds | Archive | | Supabase |
| xG Features | | Yes | Convex |
| Referee Profiles | | Yes | Convex |
| Training Data | | Yes | Convex |
| League Models | | Yes | Convex |
| Odds Snapshots | Yes | | Supabase |
| User Accumulators | Yes | | Supabase |
| Model Performance | Yes | | Supabase |

## Supabase Responsibilities

- **Authentication**: User sign-up, sign-in, session management
- **Real-time**: Live prediction updates, match status changes
- **Operational Data**: Active predictions, accumulators, user tracking
- **API Responses**: Fast reads for the frontend
- **Row-Level Security**: User data isolation
- **Odds Snapshots**: Bookmaker odds for value analysis

## Convex Responsibilities

- **Historical Data**: All settled predictions (599K+)
- **xG Features**: StatsBomb (147 teams) + Understat (484 teams)
- **Referee Profiles**: 177 referees with match history
- **Injury Data**: Player availability records
- **Training Data**: Feature-engineered datasets for model training
- **Analytics**: Aggregated statistics, calibration data
- **Complex Queries**: Analytical queries that would timeout on Supabase

## Worker/Compute Layer

Heavy processing runs as Node.js workers:

- **Ensemble Model**: Reads training data from Convex
- **Settlement Engine**: Archives settled predictions to Convex
- **Prediction Pipeline**: Generates predictions, writes to Supabase
- **Data Collection**: Scrapes data, writes to appropriate database

## Environment Variables

### Vercel (Application)

```
# Required - Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Required - Convex
CONVEX_URL=https://limitless-mole-387.convex.cloud
CONVEX_DEPLOY_KEY=dev:limitless-mole-387|xxx
CONVEX_ACCESS_TOKEN=xxx

# Optional - APIs
THE_ODDS_API_KEY=xxx
API_FOOTBALL_KEY=xxx
```

### What NOT to expose to browser

- `SUPABASE_SERVICE_ROLE_KEY` — server-side only
- `CONVEX_DEPLOY_KEY` — server-side only
- `CONVEX_ACCESS_TOKEN` — server-side only
- `THE_ODDS_API_KEY` — server-side only
- `API_FOOTBALL_KEY` — server-side only

## Convex Configuration

### Connection Details

- **URL**: `https://limitless-mole-387.convex.cloud`
- **Dashboard**: `https://dashboard.convex.dev/t/joshua-onyekachukwu/oddly/limitless-mole-387`
- **Deploy Key**: `dev:limitless-mole-387|...`
- **HTTP API**: `POST /api/query`, `POST /api/mutation`

### Tables

| Table | Purpose |
|-------|---------|
| leagues | League reference data (79) |
| teams | Team reference data (838) |
| fixtures | Historical fixtures (13,986) |
| predictions | All predictions (599K+) |
| xgFeatures | xG features (631 teams) |
| refereeProfiles | Referee statistics (177) |
| refereeMatches | Referee match history |
| injuries | Player injury records |
| matchXg | Match-level xG data |
| odds | Odds snapshots |
| trainingData | Training datasets |
| leagueModels | Per-league model parameters |
| valuePicks | Value analysis results |
| auditLog | Operation audit trail |

## Synchronization Strategy

### Direction: Supabase -> Convex

Data flows from Supabase to Convex for archival. Never the reverse for operational data.

### Triggers

1. **Settlement**: After predictions are settled in Supabase, archive to Convex
2. **Daily Cron**: Sync new fixtures and predictions
3. **On-Demand**: `npm run migrate:convex` for bulk data migration

### Failure Handling

- Archival failures are logged but don't block settlement
- Idempotent: re-running archive skips existing IDs
- All operations tracked in Convex audit log

## Rollback Strategy

If Convex becomes unavailable:

1. **Application**: Continues working — Supabase handles all user-facing queries
2. **Prediction Engine**: Falls back to local JSON files for training data
3. **Settlement**: Predictions still settle in Supabase; archival retries later
4. **Analytics**: Dashboard shows "Convex unavailable" — no crash

To fully rollback:
1. Remove `CONVEX_URL` from environment
2. Application degrades gracefully (no Convex features)
3. All data remains in Supabase

## Monitoring

### API Endpoints

- `GET /api/v1/admin/db-health` — Database comparison dashboard
- `GET /api/v1/admin/model-performance` — Model accuracy tracking

### Key Metrics

- Supabase query latency
- Convex query latency
- Archive success/failure rate
- Training data extraction time
- Settlement processing time
