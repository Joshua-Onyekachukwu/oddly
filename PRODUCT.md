# Product

<!-- uizze:product-schema 1 -->

## Platform

web

## Stack

Next.js 14 (App Router) + Tailwind CSS + Supabase (PostgreSQL, Auth, Realtime) + Vercel (hosting, cron)

## Users

**Primary:** Sports bettors and football enthusiasts who want data-driven prediction intelligence for upcoming matches. They want to identify high-confidence betting opportunities (ELITE picks) backed by statistical analysis, historical data, and multi-market modeling.

**Secondary:** Admins who manage the system, monitor prediction accuracy, manage users, and oversee the data pipeline.

## Product Purpose

ODDLY is a football prediction intelligence platform that:
- Aggregates real match data from multiple sources (The Odds API, football-data.org, API-Football)
- Generates AI-powered predictions across 26 betting markets (1X2, Over/Under, BTTS, Double Chance, Draw No Bet, Team Goals)
- Identifies ELITE golden picks — predictions with 70%+ confidence and measurable edge over bookmaker odds
- Provides accumulators and rollover chains for structured betting strategies
- Learns continuously from historical outcomes to improve prediction accuracy

## Positioning

ODDLY's differentiator is the **multi-market search engine** — rather than predicting only match results, it evaluates 26 different betting markets per match and selects the most predictable outcome. Combined with a continuous-learning pipeline that updates the model after every settled match, ODDLY pushes beyond conventional prediction ceilings. The system has achieved 93.3% accuracy on its "best market per match" selection across 9,000+ historical matches.

## Operating Context

- Users browse upcoming fixtures across 23 leagues with real team logos, league badges, and bookmaker odds
- They filter matches by date range (today, this week, this month)
- They view ELITE golden picks ranked by confidence and edge
- They build accumulators (multi-bet selections) and rollover chains (sequential daily bets)
- The system runs a daily cron at 6:00 UTC: sync fixtures → generate predictions → settle finished matches → learn from results → clean up stale data
- Admins monitor prediction accuracy via a forward-testing dashboard and manage the user base

## Capabilities and Constraints

**Capabilities:**
- Real-time fixture sync from The Odds API (23 leagues)
- Multi-market prediction engine (26 markets) using Poisson model + Elo + form analysis
- ELITE/HIGH/MEDIUM/LOW confidence tiering on every prediction
- Edge calculation (model probability vs bookmaker implied probability)
- Accumulator builder with saved selections
- Rollover chain builder with daily progression tracking
- Historical backtesting across 5,253+ finished matches
- Forward-testing with continuous learning loop
- Admin dashboard with accuracy tracking, user management, and pipeline monitoring
- Real team/league logos from API-Football CDN

**Constraints:**
- football-data.org free tier: limited to 2023-2025 seasons, 10 requests/minute
- API-Football free tier: 100 requests/day for logo sync
- The Odds API free tier: current odds only, no historical odds
- No email confirmation configured (Supabase auto-confirm)
- No Stripe/payment integration yet (infrastructure built, not live)
- No injury/suspension data API (using simulated impact based on team patterns)

## Brand Commitments

- Name: **ODDLY**
- Voice: Bold, data-driven, confident but honest about uncertainty
- Identity: Premium dark theme with gold/amber accents for ELITE picks
- Tagline concept: "Intelligence over instinct"

## Evidence on Hand

- Live deployment on Vercel
- Supabase database with 5,253+ finished matches, 174+ upcoming fixtures, 3,368+ predictions
- Historical simulation results: 93.3% best-market accuracy across 9,068 matches
- Out-of-sample validation: 92.3% (minimal overfitting)
- Real team logos for all upcoming fixture teams
- Real bookmaker odds displayed on all match cards

## Product Principles

1. **Real data only** — Never show mock, placeholder, or fabricated match data in the production interface
2. **Multi-market intelligence** — Search across all 26 markets to find the most predictable outcome per match, not just predict the winner
3. **Continuous learning** — Every settled match feeds back into the model; the system gets smarter over time
4. **Evidence-backed confidence** — Every prediction shows its probability, edge, and confidence tier so users can make informed decisions
5. **Premium without pretension** — The design should feel like a professional trading terminal, not a generic sports app

## Accessibility & Inclusion

- Responsive design: 3-4 columns on desktop, adapts to mobile
- Color is not the sole indicator of information (tier badges have text labels alongside colors)
- Keyboard navigation for dashboard navigation
