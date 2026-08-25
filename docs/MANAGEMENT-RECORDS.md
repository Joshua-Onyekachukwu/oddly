# Betting Intelligence Platform — Management Records

---

## Feature Status Matrix

| ID | Feature | Status | Area | Last Updated | Notes |
|----|---------|--------|------|-------------|-------|
| F-001 | Fixture Sync (football-data.org) | 🟢 Complete | Data | Aug 2026 | 17 leagues, 30K matches |
| F-002 | Team Composite Ratings | 🟢 Complete | Data | Aug 2026 | 405 teams |
| F-003 | StatsBomb xG Collection | 🟢 Complete | Data | Aug 2026 | 2,183 matches |
| F-004 | Referee Data Collection | 🟢 Complete | Data | Aug 2026 | 177 refs, 9,740 matches |
| F-005 | Injury Data (Transfermarkt) | 🟡 Partial | Data | Aug 2026 | 149 teams, scraping不稳定 |
| F-006 | Player Stats Collection | 🟡 Partial | Data | Aug 2026 | 265 players |
| F-007 | Standings Data | 🟢 Complete | Data | Aug 2026 | 9 leagues |
| F-008 | Odds Collection (The Odds API) | 🟡 Degraded | Data | Aug 2026 | API quota exhausted |
| F-009 | Convex Migration | 🟢 Complete | Infra | Aug 2026 | 599K predictions migrated |
| F-010 | Ensemble Model v5.1 | 🟢 Production | ML | Aug 2026 | Poisson+Elo+Reg+xG+Cal |
| F-011 | Isotonic Calibration | 🟢 Complete | ML | Aug 2026 | Applied to production |
| F-012 | Walk-Forward Validation | 🟢 Complete | Research | Aug 2026 | 3-fold, 65.6% avg |
| F-013 | Research Dataset Builder | 🟢 Complete | Research | Aug 2026 | 27K matches, 60+ features |
| F-014 | Experiment Registry | 🟢 Complete | Research | Aug 2026 | 3 experiments tracked |
| F-015 | CLV Tracker | 🟡 Partial | Odds | Aug 2026 | Implemented, limited data |
| F-016 | Predicted Lineups Engine | 🟡 Partial | Feature | Aug 2026 | No injury data integration |
| F-017 | Golden Picks Page | 🟢 Complete | Product | Aug 2026 | League/market filtering |
| F-018 | ELITE Picks Classification | 🟢 Complete | Product | Aug 2026 | ≥70% confidence |
| F-019 | Match Detail Drawer | 🟢 Complete | Product | Aug 2026 | H2H, form, 24 markets |
| F-020 | Rollover Challenge | 🟡 Partial | Product | Aug 2026 | Basic implementation |
| F-021 | Admin Accuracy Dashboard | 🟢 Complete | Admin | Aug 2026 | Convex real-time |
| F-022 | Admin Convex Health | 🟢 Complete | Admin | Aug 2026 | Migration status |
| F-023 | Admin System Health | 🟡 Partial | Admin | Aug 2026 | Hardcoded values |
| F-024 | AI Betting Agent | 🔵 Planned | AI | — | API routes exist |
| F-025 | Weather Data Collection | 🔵 Planned | Data | — | OpenWeatherMap |
| F-026 | Asian Handicap Odds | 🔵 Planned | Odds | — | OddsPortal |
| F-027 | Starting Lineup Integration | 🔵 Planned | Feature | — | Understat/API-Football |
| F-028 | Database RLS | 🔴 Blocked | Security | — | CRITICAL: Not implemented |
| F-029 | Rate Limiting | 🔴 Blocked | Security | — | Not implemented |
| F-030 | Admin Auth Middleware | 🔴 Blocked | Security | — | Not implemented |

---

## Model Registry

| ID | Model | Version | Algorithm | Accuracy | LogLoss | Brier | ECE | Status | Date |
|----|-------|---------|-----------|----------|---------|-------|-----|--------|------|
| M-001 | Majority Class | — | Constant | 56.2% | 0.687 | 0.247 | — | 🔴 Rejected | Jul 2026 |
| M-002 | Poisson Only | v3.0 | Poisson | 60.1% | 0.665 | 0.235 | — | 🔴 Deprecated | Jul 2026 |
| M-003 | Ensemble v3.0 | v3.0 | Poisson+Elo+Reg | 62.8% | 0.640 | 0.225 | — | 🔴 Deprecated | Jul 2026 |
| M-004 | Ensemble v5.0 | v5.0 | Poisson+Elo+Reg+xG | 65.6% | 0.622 | 0.217 | 0.039 | 🔴 Superseded | Aug 2026 |
| **M-005** | **Ensemble v5.1** | **v5.1** | **Poisson+Elo+Reg+xG+Cal** | **65.6%** | **0.622** | **0.217** | **0.035** | **🟢 Production** | **Aug 2026** |
| M-006 | XGBoost v6 | v6 | XGBoost (47 features) | 68.6% | 0.602 | 0.207 | — | 🔵 Candidate | Aug 2026 |
| M-007 | Per-League XGBoost | — | XGBoost per league | 63-72% | — | — | — | 🟡 Experimental | Aug 2026 |
| M-008 | Isotonic Calibrator | — | Isotonic Regression | — | — | — | 0.020 | 🟢 Applied to M-005 | Aug 2026 |

### Model Promotion Rules

A candidate model must demonstrate:
1. Better unseen accuracy (walk-forward)
2. Sample size ≥ 1,000 predictions
3. Better or equivalent calibration (ECE)
4. Better or equivalent log loss
5. No evidence of data leakage
6. Stable performance across all folds
7. No catastrophic degradation in any league

---

## Dataset Registry

| ID | Dataset | Records | Leagues | Seasons | Features | Source | Status |
|----|---------|---------|---------|---------|----------|--------|--------|
| D-001 | Football-Data.org Matches | 30,340 | 17 | 2021-2026 | 24 | football-data.org | 🟢 Primary |
| D-002 | Team Composite Ratings | 405 teams | — | All-time | 30 | Computed | 🟢 Primary |
| D-003 | StatsBomb xG | 2,183 matches | 7 | 2017-2026 | 15 | StatsBomb Open | 🟢 Primary |
| D-004 | Referee Profiles | 177 refs | 17 | 2021-2026 | 10 | Computed | 🟢 Primary |
| D-005 | Referee Match History | 9,740 matches | 17 | 2021-2026 | 12 | football-data.org | 🟢 Primary |
| D-006 | Injury Data | 149 teams | Top leagues | Current | 5 | Transfermarkt | 🟡 Partial |
| D-007 | Player Stats | 265 players | 8 leagues | Current | 25 | API-Football | 🟡 Partial |
| D-008 | Standings | 9 leagues | — | Current | 8 | Computed | 🟢 Primary |
| D-009 | Odds Snapshots | 14,984 | Multiple | Current | 7 | The Odds API | 🟡 Exhausted |
| D-010 | Research Dataset | 27,314 | 17 | 2021-2026 | 60+ | Computed | 🟢 Research |
| D-011 | Understat xG | 0 | 5 | — | — | Understat | 🔴 Empty |
| D-012 | Weather Data | 0 | — | — | — | — | 🔴 Not collected |
| D-013 | Starting Lineups | 0 | — | — | — | — | 🔴 Not collected |

---

## Architecture Decision Log

| ID | Date | Decision | Context | Alternatives | Reason | Consequences |
|----|------|----------|---------|-------------|--------|-------------|
| ADR-001 | Jul 2026 | Use Supabase as hot database | Need database for predictions | Firebase, MongoDB, raw PostgreSQL | Free tier, PostgreSQL, built-in auth | 500MB limit approaching |
| ADR-002 | Aug 2026 | Add Convex for cold storage | Supabase hitting limits | BigQuery, S3, separate PostgreSQL | Free tier, real-time subscriptions | Dual-database complexity |
| ADR-003 | Aug 2026 | Use ensemble over single model | Single model plateau | XGBoost only, Neural Network | Model diversity improves generalization | More complex, harder to interpret |
| ADR-004 | Aug 2026 | Apply isotonic calibration | Probabilities slightly off | Platt scaling, temperature scaling | Better ECE, no assumptions | Slight accuracy drop |
| ADR-005 | Aug 2026 | Walk-forward validation | Need honest evaluation | Random split, k-fold | Prevents future information leakage | Lower but honest accuracy |
| ADR-006 | Aug 2026 | Use football-data.org as primary | Need historical match data | API-Football, Opta, StatsPerform | Free, 17 leagues, 5 years coverage | Limited to free tier (500 req/mo) |
| ADR-007 | Aug 2026 | Use Elo as primary strength rating | Need team strength measure | FIFA rankings, custom ratings | Simple, proven, no external dependency | Less nuanced than custom ratings |

---

## Open Issues & Risks

### 🔴 Critical (Fix Immediately)

| ID | Issue | Impact | Discovered | Status |
|----|-------|--------|-----------|--------|
| ISS-001 | No RLS on Supabase | Security breach — all data readable | Aug 2026 | OPEN |
| ISS-002 | Only 1 cron registered in Vercel | Settlement/prediction not running | Aug 2026 | OPEN |
| ISS-003 | Settle cron uses inline Poisson | Accuracy metrics based on wrong model | Aug 2026 | OPEN |
| ISS-004 | 3 Supabase tables missing | Referee features broken | Aug 2026 | OPEN |

### 🟡 High (Fix This Week)

| ID | Issue | Impact | Discovered | Status |
|----|-------|--------|-----------|--------|
| ISS-005 | No feature snapshots in predictions | No traceability | Aug 2026 | OPEN |
| ISS-006 | No admin auth middleware | Unauthorized admin access | Aug 2026 | OPEN |
| ISS-007 | Hardcoded accuracy fallback | Misleading numbers | Aug 2026 | OPEN |
| ISS-008 | No rate limiting on API | Abuse vulnerability | Aug 2026 | OPEN |
| ISS-009 | Odds API exhausted | No odds features | Aug 2026 | OPEN |
| ISS-010 | Understat xG empty | Missing xG data | Aug 2026 | OPEN |
| ISS-011 | Inconsistent model versions | Confusing metrics | Aug 2026 | OPEN |

### 🟢 Resolved

| ID | Issue | Resolution | Date |
|----|-------|-----------|------|
| ISS-012 | Convex migration incomplete | 599K predictions migrated | Aug 2026 |
| ISS-013 | Referee data not in Convex | 9,740 matches migrated | Aug 2026 |
| ISS-014 | Probabilities not calibrated | Isotonic calibration applied | Aug 2026 |
| ISS-015 | No honest evaluation | Walk-forward validation implemented | Aug 2026 |

---

## Change Log

| Date | Change | Reason | Affected System | Migration | Status |
|------|--------|--------|----------------|-----------|--------|
| Jul 2026 | Initial platform launch | MVP | All | None | ✅ |
| Jul 2026 | Poisson model v1 | Baseline predictions | ML | None | ✅ |
| Jul 2026 | Elo integration | Improved accuracy | ML | None | ✅ |
| Jul 2026 | XGBoost v5 | Advanced ML | ML | None | ✅ |
| Aug 2026 | Ensemble v5.0 | Combined models | ML | None | ✅ |
| Aug 2026 | Convex migration | Cold storage | Infra | Data migration | ✅ |
| Aug 2026 | Referee features | 177 refs | ML | Convex migration | ✅ |
| Aug 2026 | Isotonic calibration | Better probabilities | ML | Model file | ✅ |
| Aug 2026 | Walk-forward validation | Honest evaluation | Research | None | ✅ |
| Aug 2026 | Research loop infrastructure | Audit, dataset, experiments | Research | New scripts | ✅ |
| Aug 2026 | Full system audit | Identify issues | All | None | ✅ |
| Aug 2026 | Master documentation | Single source of truth | Docs | None | ✅ |

---

## Model & Dataset Version History

### Dataset Evolution

| Version | Date | Matches | Leagues | Seasons | Features | Key Change |
|---------|------|---------|---------|---------|----------|-----------|
| v1 | Jul 2026 | 10,403 | 6 | 2021-2024 | 30 | Initial dataset |
| v2 | Aug 2026 | 13,986 | 6 | 2021-2025 | 34 | Added 2025 season |
| **v3** | **Aug 2026** | **27,314** | **17** | **2021-2026** | **60+** | **Added 11 leagues** |

### Model Evolution

| Version | Date | Algorithm | Accuracy | Key Change |
|---------|------|-----------|----------|-----------|
| v1.0 | Jul 2026 | Poisson | 60.1% | Initial model |
| v2.0 | Jul 2026 | Poisson+Elo | 62.8% | Added Elo |
| v3.0 | Jul 2026 | Ensemble | 63.5% | Added regression |
| v4.0 | Aug 2026 | Ensemble+xG | 64.8% | Added xG |
| v5.0 | Aug 2026 | Optimized Ensemble | 65.6% | Optimized weights |
| **v5.1** | **Aug 2026** | **Calibrated Ensemble** | **65.6%** | **Isotonic calibration** |

---

*This file is updated with every significant change to the platform.*
