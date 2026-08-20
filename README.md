# ODDLY 🦊

> *"Oddly accurate."*

## What Is ODDLY?

ODDLY is a **betting intelligence system** that collects match data and odds from multiple sources, runs statistical models to estimate probabilities, identifies value bets, and helps users make informed decisions.

**This is NOT a betting site.** Users do not place bets here. No money flows through the platform. It is a **decision-support tool** that estimates probabilities and identifies value.

---

## What ODDLY Does

- Collects match data and odds from multiple sources (5,000+ matches per season)
- Runs statistical models (Dixon-Coles, XGBoost, Ensemble) to estimate probabilities
- Compares model probabilities against bookmaker prices
- Identifies where value exists (positive expected value)
- Explains every prediction with transparent reasoning
- Tracks every prediction and verifies outcomes automatically
- Builds a public, verifiable model track record
- Helps users construct accumulators with honest probability estimates (no hard limit)
- Provides an AI analyst that controls the system via natural language
- Offers a rollover challenge feature for daily engagement (Elite subscribers only)
- Manages risk with Kelly criterion staking and drawdown tracking
- Provides a full admin panel for platform operators

---

## The User Experience

The user opens the dashboard and sees:

**Today's games → available markets → odds → model probabilities → value → risk → recommended bets → build your own accumulator → track results.**

---

## Subscription Tiers

| Tier | Price | Key Features |
|------|-------|--------------|
| **Free** | ₦0 | Dashboard, basic filters, 10-leg accumulators, 3 AI questions/day |
| **Premium** | ₦7,500/mo | Unlimited accumulators, optimizer, Monte Carlo, unlimited AI chat |
| **Elite** | ₦20,000/mo | Crown jewel daily pick, deep analysis, early access, priority support |

---

## Technology Stack

| Layer | Technology | Cost |
|---|---|---|
| Frontend + API routes | **Vercel** (Next.js) | Free tier |
| Database + Auth + Realtime | **Supabase** (PostgreSQL) | Free tier |
| AI / LLM inference | **NVIDIA NIM API** (free keys) | Free |
| Statistical model | **Python on GitHub Actions** | Free |
| Data collection | **Python on GitHub Actions** | Free |
| Caching | **Supabase + Vercel edge cache** | Free |
| Monitoring | **Vercel Analytics + UptimeRobot** | Free |

**Total infrastructure cost to start: ₦0/month**

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Joshua-Onyekachukwu/oddly.git

# Navigate to project
cd oddly

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Brand Identity](./docs/BRAND.md) | ODDLY brand guidelines, voice, and visual identity |
| [Development Plan](./docs/DEVELOPMENT_PLAN.md) | Full 10-12 week roadmap with phases and milestones |
| [Database Schema](./docs/DATABASE_SCHEMA.md) | Complete Supabase schema with RLS policies |
| [Skills & Tools](./docs/SKILLS_AND_TOOLS.md) | All required packages and dependencies |
| [Questions](./docs/QUESTIONS.md) | Open questions and clarifications |

---

## Core Philosophy

### What We Optimize For

**Risk-Adjusted Expected Value.** Not maximum odds. Not "sure bets." Not guaranteed profit.

### What We Show

Every prediction. Every result. Every calibration stat. Losses alongside wins. The model's track record is public and verifiable.

### What We Never Do

- Promise guaranteed outcomes
- Hide losing predictions
- Pretend a 200-leg accumulator is "safe"
- Express false certainty
- Encourage reckless staking
- Rush. Force a bad pick. Skip the skip day.

---

## The Name

**ODDLY.** *"Oddly accurate."*

One word. Weird enough to make someone stop scrolling. Clean enough to put on a T-shirt. The name is the brand.

---

## The One Question

**Does this model actually find value that the market is missing?**

If yes, everything else is product packaging. If no, no amount of dashboard design fixes it.

---

Built with ❤️ by Joshua Onyekachukwu & The ODDLY Team

🦊 *"Oddly accurate."*
