# ODDLY — Prediction Intelligence Architecture

Audit date: 2026-10-02. Proposed target architecture. Design principle:
**every number shown to a user must be traceable to real model inputs** — no
invented narratives, no conflated scores.

## 1. Layered architecture

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTATION — predictions UI, confidence tiers, explanations│
├─────────────────────────────────────────────────────────────┤
│ EVIDENCE & SCORING — confidence gates, data-quality score,   │
│   abstention ("NO RELIABLE PREDICTION"), tier assignment      │
├─────────────────────────────────────────────────────────────┤
│ CALIBRATION — per-market/league isotonic calibrators,        │
│   reliability metrics (Brier/logloss/ECE), CIs               │
├─────────────────────────────────────────────────────────────┤
│ MODEL ZOO — 1X2 (Dixon-Coles/Poisson/XGB), goals (Poisson/NB),│
│   BTTS, DC, DNB, HT/FT … champion/challenger per market       │
├─────────────────────────────────────────────────────────────┤
│ FEATURE STORE — unified, point-in-time-correct features      │
│   (team strength, form, xG, injuries, lineups, referee,       │
│   market odds, weather, context)                             │
├─────────────────────────────────────────────────────────────┤
│ DATA PLATFORM — collectors → raw tables → cleaned features   │
│   (API-Football, football-data, StatsBomb, Understat, odds,  │
│   weather, injuries/lineups)                                 │
└─────────────────────────────────────────────────────────────┘
```

## 2. Component specifications

### 2.1 Data platform (fix first)
- **Single schema of record:** Supabase (new project). Local `data/` JSONs become
  build artifacts, not sources of truth.
- **Point-in-time correctness:** every feature table carries `as_of`/snapshot
  timestamps; predictions store `input_snapshot` (column already exists).
- **Retention fixes:** `odds_snapshots` must keep pre-match + closing history
  (remove ~1h pruning); CLV computed in DB, not ephemeral JSON.
- **Backfill:** migrate or rebuild the 30K-match history + 599K prediction log
  into the new project (decision pending — see DATA-INVENTORY §5).

### 2.2 Feature store
Unify today's scattered stores (`team_feature_profiles`, `match_features`,
`fixture_injury_features`, local JSONs) into one versioned feature layer:

| Feature group | Source | Status |
|---------------|--------|--------|
| Team strength (Elo, attack/defense ratings) | fixtures history | Live |
| Form (multiple windows, H/A splits) | fixtures history | Live |
| xG / xGA | StatsBomb + Understat | Data exists, not joined |
| Player availability & importance | API-Football + impact engine | Half-wired, buggy |
| Confirmed lineups | API-Football lineups | Not collected |
| Referee tendencies | football-data referee field | Collected, zero measured lift |
| Market odds (opening/current/closing) | The Odds API + SharpAPI | Thin, retention-broken |
| Weather | Open-Meteo archive+forecast | Forward-only currently |
| Context (rest, travel, motivation, derby) | Derived | Mostly missing |

Every feature gets: definition, source, freshness SLA, historical availability
flag (can it be backtested?), and measured lift (or "unproven").

### 2.3 Model zoo (per market, champion/challenger)
- **1X2:** Dixon-Coles (new — industry standard, handles low-score correlation),
  Poisson, existing JS ensemble, XGB classifier. Champion per league-group.
- **Goals:** Poisson → negative-binomial (overdispersion); per-line models.
- **BTTS / DC / DNB:** derived from calibrated 1X2 + dedicated challengers.
- **Calibration:** isotonic per market+league-group on a held-out window.
- **Promotion gate:** walk-forward lift on Brier/log-loss + ECE improvement,
  minimum sample sizes, per-league breakdown — documented in `validation_results`.

### 2.4 Evidence & scoring engine (the "intelligence" layer)
For every candidate prediction, compute and store:

- `p_calibrated` per market/selection
- `model_confidence` = f(ensemble agreement, calibration quality, CI width)
- `data_quality_score` = f(feature completeness, lineup certainty,
  injury freshness, odds freshness) — populate consistently
- `evidence_summary` = **generated from actual inputs**, e.g.:
  "Arsenal attack rating 1.8σ above league avg · Chelsea missing GK + CB
  (confirmed XI) · home xG-for 2.1 vs away xGA 1.9 · market implies 62%,
  model 65% (calibrated) · data quality: high (lineup confirmed 40min ago)"
- `abstain_reason` when gates fail

This is what makes ODDLY a *prediction intelligence* platform rather than a
black-box tipster: the explanation is a deterministic rendering of the feature
vector and model outputs, not LLM-generated narrative.

### 2.5 Selection & rollover integration
- The 2.00-odds rollover engine consumes **calibrated probabilities +
  data-quality + correlation adjustments**, never raw model output.
- Combined-ticket probability accounts for leg correlation (same-match
  markets are NOT independent).
- "No qualifying ticket" remains a first-class outcome.

## 3. What changes vs today

| Today | Target |
|-------|--------|
| JS ensemble only, with bugs | Model zoo + champion/challenger per market |
| No calibration in prod | Per-market/league isotonic, reliability-gated |
| Confidence = prob threshold | Two-gate evidence system + honest abstention |
| Scattered feature stores | Unified versioned feature store |
| Explanations absent/fabricated | Deterministic evidence summaries from real inputs |
| Odds history destroyed | Full pre-match/closing snapshot retention |
| 599K predictions, unknown accuracy | Every prediction carries snapshot + quality + outcome for honest eval |

## 4. Build order (maps to IMPROVEMENT-ROADMAP)

1. Data platform repairs (retention, backfill, weight-config fix, injury sign bug)
2. Feature store unification + point-in-time correctness
3. Calibration layer + restored walk-forward eval
4. Evidence/scoring engine + abstention
5. Model zoo expansion (Dixon-Coles, NB goals) via champion/challenger
6. Explanation generation + UI confidence tiers
7. Market expansion (HT/FT, team totals) only after gates pass
