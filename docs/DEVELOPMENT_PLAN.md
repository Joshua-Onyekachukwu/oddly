# ODDLY Development Plan — V3.0 Roadmap

## Overview

**Duration:** 10-12 weeks
**Stack:** Vercel · Supabase · NVIDIA NIM (free) · Python Workers (free)
**Infrastructure cost to start: ₦0**

---

## Phase 1 — Foundation (Weeks 1-2)

### Data Layer
- [ ] Set up free APIs (The Odds API, API-Football, Football-Data.org)
- [ ] Build data collector worker (Python)
- [ ] Normalize team names via team_aliases
- [ ] Write to Supabase via service role
- [ ] Set up GitHub Actions cron (every 30 min)
- [ ] FBref/Sofascore enrichment
- [ ] Team aliases system

### Database
- [ ] Full Supabase schema (all tables from V3.0 spec)
- [ ] Row Level Security (RLS) policies
- [ ] Auth setup (email/password, social)
- [ ] Profiles table with role-based access (user/admin)
- [ ] Seed admin user

### ML/Model
- [ ] Dixon-Coles model in Python
- [ ] Train on historical data
- [ ] Generate predictions for today's fixtures
- [ ] Margin removal (multiplicative method)
- [ ] Edge calculation
- [ ] Model versioning

### Frontend
- [ ] Next.js 14+ scaffold with App Router
- [ ] ODDLY branding (logo, colors, typography)
- [ ] Dashboard page (Today's Scan)
- [ ] Match detail page with prediction breakdown
- [ ] Basic filters (probability, odds, market, risk, league)
- [ ] Trezo template integration

### Infrastructure
- [ ] Vercel project setup
- [ ] Environment variables configured
- [ ] Supabase project created
- [ ] Initial deployment

**Deliverable:** Dashboard with model probabilities, odds, edge, filters. Data refreshes every 30 min. ODDLY branding applied.

---

## Phase 2 — Scoring + Accumulator (Weeks 2-4)

### ML/Model
- [ ] Multi-market output (1X2, Over/Under, BTTS, Asian Handicap, etc.)
- [ ] Correlation matrix between selections
- [ ] Monte Carlo simulation (100,000 runs)
- [ ] Model disagreement detection
- [ ] Sub-model probabilities (Dixon-Coles, XGBoost, Elo, Market)

### Backend
- [ ] Opportunity Score calculation (0-100)
- [ ] Data Quality Score calculation (0-100)
- [ ] Accumulator builder (unlimited legs for Premium/Elite)
- [ ] Accumulator optimizer
- [ ] Kelly criterion staking
- [ ] Risk-Adjusted Expected Value
- [ ] AVOID flag logic
- [ ] Probability breakdown by leg count

### Frontend
- [ ] Accumulator builder (manual, unlimited legs)
- [ ] Optimizer form (target odds, max selections, min probability)
- [ ] Correlation warnings
- [ ] Probability display (honest, combined odds)
- [ ] Opportunity Score badges
- [ ] Data Quality indicators
- [ ] AVOID flags
- [ ] Filter by Opportunity Score

**Deliverable:** Filter by Opportunity Score. Build accumulators with optimizer. See true probability and EV. Probability breakdown for large accumulators.

---

## Phase 3 — AI + Tracking (Weeks 4-6)

### AI Integration (System Control)
- [ ] NVIDIA NIM keys (8-10 from build.nvidia.com)
- [ ] NVIDIA client with key rotation
- [ ] Task router (chat → Llama 70B, explain → Mistral, classify → Phi-3, etc.)
- [ ] AI analyst chat page (streaming)
- [ ] "Why?" button on every prediction
- [ ] Response caching (Supabase ai_cache, 1-hour TTL)
- [ ] System prompts for all tasks
- [ ] Responsible gambling guardrails
- [ ] Natural language queries (find games, build accumulators, manage rollover)

### Backend
- [ ] Settlement worker (GitHub Actions, every 15 min)
- [ ] Prediction lifecycle (CREATED → PENDING → IN PLAY → SETTLED)
- [ ] P&L API
- [ ] Model performance tracking (Brier score, calibration)

### Frontend
- [ ] AI chat page with streaming
- [ ] "Why?" expansion panels
- [ ] Tracking dashboard (P&L, ROI, yield)
- [ ] Model report card (public)

### Admin Panel
- [ ] Admin layout with sidebar
- [ ] Overview / system status
- [ ] Model health & calibration charts
- [ ] Data pipeline monitoring
- [ ] User management (list, detail, suspend)

**Deliverable:** AI analyst live (system control). Predictions tracked and verified. Admin panel operational.

---

## Phase 4 — Rollover + Subscriptions (Weeks 6-8)

### ML/Model
- [ ] Backtesting engine (historical validation)
- [ ] XGBoost ensemble model
- [ ] Model versioning (deploy alongside old, compare)
- [ ] A/B testing framework
- [ ] Calibration plots & reliability diagrams

### Backend
- [ ] Rollover chain CRUD
- [ ] Daily crown jewel pick engine (scan 2,100+ matches, filter to top 1)
- [ ] Recalibration triggers (hit rate drops below threshold)
- [ ] Drawdown tracking
- [ ] Post-match AI analysis
- [ ] Subscription system (Free, Premium, Elite)
- [ ] Payment integration (Paystack/Korapay)
- [ ] Tier enforcement (feature gating)

### Frontend
- [ ] Rollover challenge UI (chain progress, daily pick, history)
- [ ] Backtesting results page
- [ ] Model version comparison
- [ ] Subscription management page
- [ ] Payment flow

### Admin Panel (continued)
- [ ] Scoring configuration (weights, thresholds, tiers)
- [ ] Content management (leagues, teams, aliases)
- [ ] Rollover oversight (active chains, crown jewel pick generation)
- [ ] NVIDIA monitoring (key usage, cache hit rate, latency)
- [ ] Subscription management

### Notifications
- [ ] Notification system
- [ ] In-app alerts
- [ ] Rollover milestones
- [ ] Priority notifications for Elite subscribers

**Deliverable:** Rollover live. Crown jewel pick for Elite. Ensemble model. Notifications. Full admin panel. Subscriptions active.

---

## Phase 5 — Polish + Scale (Weeks 8-10)

### Data
- [ ] Increased collection frequency
- [ ] Live odds polling
- [ ] Steam detection
- [ ] Market overreaction analysis

### Backend
- [ ] Supabase Realtime subscriptions
- [ ] Opportunity scanner (background job)

### Frontend
- [ ] Live odds ticker
- [ ] Opportunity scanner UI
- [ ] Mobile-responsive design
- [ ] PWA setup (service worker, manifest)

### AI
- [ ] Responsible gambling layer (P&L display for losing users, friction)

### Admin Panel (final)
- [ ] Announcements system
- [ ] Financials dashboard
- [ ] System logs viewer
- [ ] Settings page (all configurable options)

### Legal
- [ ] Disclaimer on every page
- [ ] Privacy policy
- [ ] NDPR compliance

**Deliverable:** Public-ready. Mobile. Live data. Legally compliant. Full admin. Subscriptions generating revenue.

---

## Phase 6 — Dollar Sites + Growth (Weeks 10-12)

### Data
- [ ] Pinnacle, Betfair, 1xBet international odds

### ML
- [ ] Additional markets
- [ ] Additional sports (basketball)

### Frontend
- [ ] Multi-bookmaker display

### Testing
- [ ] Beta testing (20-50 users)
- [ ] Iterate based on feedback

### Research
- [ ] Betfair/Pinnacle API access
- [ ] Automation feasibility study

**Deliverable:** Multi-bookmaker. Multi-sport. Automation research complete.

---

## Phase 7+ — Automation (Future)

**Deferred to Phase 7+.** Manual betting only for Phase 1-6.

| Workstream | Tasks |
|------------|-------|
| Backend | Betfair/Pinnacle API integration. Bet placement logic. |
| Backend | Safety limits. Kill switches. Reconciliation. |
| Frontend | Automation dashboard. Manual confirmation mode. Full auto mode. |
| Testing | Paper trading with automation. Small stakes ($5). Gradual scale. |

---

## Ongoing Tasks

| Task | Frequency |
|------|-----------|
| Retrain models | Weekly |
| Review calibration | Weekly |
| A/B test versions | Bi-weekly |
| Add markets/leagues | Monthly |
| Review NVIDIA usage | Monthly |
| User feedback review | Continuous |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Lighthouse score | > 90 |
| Initial load time | < 3 seconds |
| Model accuracy (90%+ tier) | > 90% |
| Model accuracy (overall) | > 75% |
| API response time | < 500ms |
| NVIDIA cache hit rate | > 30% |
| Uptime | > 99.5% |
| Subscription conversion (Month 6) | > 5% of active users |

---

## Revenue Milestones

| Month | Target |
|-------|--------|
| Month 1 | ₦17,860 profit (model validation) |
| Month 3 | ₦66,460 cumulative |
| Month 6 | ₦1,214,460 cumulative + ₦6.25M subscription revenue |
| Month 12 | ₦77,764,460 cumulative + ₦17.5M subscription revenue |

---

*Last Updated: August 2026*
