# ODDLY Injury Intelligence System

A comprehensive injury tracking, feature engineering, and prediction integration system for the ODDLY betting intelligence platform.

## Overview

The Injury Intelligence System provides:

1. **Multi-source injury collection** with validation and monitoring
2. **Historical snapshot preservation** for ML validation
3. **Feature engineering pipeline** for team and fixture-level features
4. **Admin dashboard** for monitoring and analysis
5. **Prediction integration** with leakage prevention
6. **Ablation testing** to measure model improvement

## Architecture

### Database Tables

| Table | Purpose |
|-------|---------|
| `player_availability` | Current injury/suspension status for players |
| `injury_snapshots` | Historical snapshots for ML validation |
| `team_injury_features` | Computed features per team per fixture |
| `fixture_injury_features` | Combined home/away features for predictions |
| `injury_collection_log` | Monitoring and data quality tracking |

### Views

| View | Purpose |
|------|---------|
| `team_injury_summary_v2` | Aggregated team injury statistics |
| `injury_dashboard_summary` | Dashboard summary metrics |
| `fixture_injury_overview` | Fixture-level injury overview |

## Setup

### 1. Database Setup

Run the enhanced injury system migration:

```bash
# In Supabase SQL Editor, run:
supabase/20260902000000_enhanced_injury_system.sql
```

### 2. Data Collection

Collect injury data from available sources:

```bash
# Collect from all sources
node scripts/collect-injuries-enhanced.js

# Collect from specific source
node scripts/collect-injuries-enhanced.js --source premierinjuries
node scripts/collect-injuries-enhanced.js --source apifootball

# Dry run (no database changes)
node scripts/collect-injuries-enhanced.js --dry-run
```

### 3. Feature Computation

Compute injury features for upcoming fixtures:

```bash
# Compute for all upcoming fixtures
node scripts/compute-injury-features.js

# Compute for specific fixture
node scripts/compute-injury-features.js --fixture <fixture_id>
```

### 4. Run Tests

Verify the system is working:

```bash
node scripts/test-injury-system.js
```

## Admin Dashboard

Access the Injury Intelligence Dashboard at `/admin/injuries`.

### Dashboard Sections

#### Summary
- Total affected teams
- Total injured/suspended/doubtful players
- Collection status and data freshness

#### Fixture View
- Upcoming fixtures with injury impact
- Home vs away comparison
- Injury difference scoring

#### Team Detail
- Select a team to view detailed injury information
- Impact scores and player breakdown

#### Data Quality
- Data freshness monitoring by team
- Collection logs and error tracking
- Source reliability metrics

## API Endpoints

### GET /api/v1/injuries/features

Get injury features for a fixture with leakage prevention.

**Parameters:**
- `fixture_id` (required): Fixture ID
- `prediction_time` (optional): ISO timestamp for historical lookup

**Response:**
```json
{
  "success": true,
  "features": {
    "fixture_id": "...",
    "home_team": "...",
    "away_team": "...",
    "home_features": { ... },
    "away_features": { ... },
    "injury_difference": 2.5,
    "availability_difference": -5.2,
    ...
  },
  "snapshot_date": "...",
  "leakage_prevention": "Using historical snapshot from before prediction time"
}
```

### POST /api/v1/injuries/collect

Trigger injury collection (admin only).

**Body:**
```json
{
  "source": "premierinjuries" | "apifootball" | "all"
}
```

### POST /api/v1/injuries/features

Compute injury features for fixtures (admin only).

**Body:**
```json
{
  "fixture_id": "..."  // or
  "all": true
}
```

## Feature Engineering

### Team-Level Features

| Feature | Description |
|---------|-------------|
| `total_unavailable` | Total players unavailable |
| `injured_count` | Players injured |
| `suspended_count` | Players suspended |
| `doubtful_count` | Players doubtful |
| `availability_pct` | Squad availability percentage |
| `missing_starters` | Missing first-team players |
| `missing_key_players` | Missing key players |
| `missing_goalkeeper` | Missing goalkeeper |
| `missing_defenders` | Missing defenders |
| `missing_midfielders` | Missing midfielders |
| `missing_attackers` | Missing attackers |
| `injury_impact_score` | Weighted impact score |
| `key_player_impact` | Impact from key players |
| `data_freshness_hours` | Hours since last update |
| `confidence_score` | Data confidence (0-1) |

### Fixture-Level Features

| Feature | Description |
|---------|-------------|
| `home_*` | Home team features |
| `away_*` | Away team features |
| `injury_difference` | Home - Away injury impact |
| `availability_difference` | Home - Away availability |
| `key_player_absence_difference` | Key player absence diff |
| `attacking_absence_difference` | Attacker absence diff |
| `defensive_absence_difference` | Defender absence diff |

## Data Leakage Prevention

The system prevents data leakage through:

1. **Historical snapshots**: All injury data is timestamped
2. **Prediction-time queries**: Features are queried using `prediction_time`
3. **Snapshot validation**: Only data available before prediction is used
4. **Audit trail**: All snapshots are logged for verification

### How It Works

When generating a prediction:

1. Prediction requests injury features with `prediction_time`
2. System queries `team_injury_features` where `snapshot_date <= prediction_time`
3. Returns the most recent valid snapshot
4. No future data can leak into historical predictions

## Ablation Testing

Run ablation testing to measure injury feature impact:

```bash
node scripts/injury-ablation-test.js
```

### What It Measures

- Baseline model accuracy (without injuries)
- Model accuracy with injury features
- Per-class precision/recall/F1
- Log loss and Brier score
- Injury difference impact on accuracy

### Results

Results are saved to `data/injury-ablation-results.json` with:

- Before/after metrics
- Improvement calculations
- Statistical significance
- Feature importance analysis

## Cron Integration

Add injury collection to daily cron:

```javascript
// In your cron job
const { execSync } = require("child_process");

// Run injury collection
execSync("node scripts/collect-injuries-enhanced.js");

// Compute features for upcoming fixtures
execSync("node scripts/compute-injury-features.js");
```

## Data Sources

### Premier Injuries

- Source: premierinjuries.com
- Coverage: Premier League
- Update frequency: Daily
- Status: Cached (requires manual refresh)

### API-Football

- Source: api-football.com
- Coverage: Multiple leagues
- Update frequency: Rate-limited
- Status: Requires API key

## Monitoring

### Data Freshness

- **Fresh**: Updated within 24 hours
- **Stale**: Updated within 72 hours
- **Very Stale**: Updated within 7 days
- **Missing**: No recent updates

### Collection Monitoring

Track in `injury_collection_log`:
- Collection start/completion time
- Records found/inserted/updated/rejected
- Error messages
- Source status

## Troubleshooting

### No Injury Data

1. Check if collection has run: `node scripts/collect-injuries-enhanced.js`
2. Verify database tables exist: `node scripts/test-injury-system.js`
3. Check collection logs in admin dashboard

### Features Not Computing

1. Verify upcoming fixtures exist
2. Check team names match between fixtures and injuries
3. Run feature computation manually: `node scripts/compute-injury-features.js`

### Prediction Integration Issues

1. Verify injury features exist for fixture
2. Check prediction_time is after snapshot_date
3. Review API response for error messages

## Performance Considerations

- Feature computation runs asynchronously
- Historical snapshots are created on-demand
- Database indexes optimize query performance
- Collection uses rate limiting to avoid API limits

## Security

- All tables have RLS enabled
- Service role required for writes
- Public read access for features
- Admin-only access for collection triggers

## Future Enhancements

- [ ] Real-time injury alerts
- [ ] Player importance scoring from squad data
- [ ] Historical injury impact analysis
- [ ] Machine learning injury prediction
- [ ] Integration with additional data sources
- [ ] Automated key player detection
