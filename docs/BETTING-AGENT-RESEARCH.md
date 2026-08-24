# AI Betting Agent — Research Report & Architecture

**Date:** August 24, 2026
**Status:** Research Complete — Ready for MVP Planning

---

## A. Nigerian Bookmaker Comparison

| Bookmaker | Market Share | API Available | Booking Code | Deep Links | Affiliate Program |
|-----------|-------------|---------------|--------------|------------|-------------------|
| **SportyBet** | #1 Nigeria | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |
| **Bet9ja** | #2 Nigeria | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |
| **BetKing** | #3 Nigeria | ❌ No public API (Cloudflare protected) | ✅ Yes | ❌ No | ✅ Yes |
| **1xBet** | #4 Nigeria | ⚠️ Affiliate API only (tracking) | ✅ Yes | ⚠️ Affiliate links | ✅ Yes |
| **Betway** | Top 5 | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |
| **MSport** | Growing | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |
| **NairaBET** | Mid-tier | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |
| **Paripesa** | Growing | ❌ No public API | ✅ Yes | ❌ No | ✅ Yes |

**Key Finding:** No major Nigerian bookmaker provides a public developer API for odds retrieval or bet placement.

---

## B. Official APIs

### The Odds API (the-odds-api.com)
- **Coverage:** 40+ global bookmakers (DraftKings, FanDuel, Bet365, Pinnacle, etc.)
- **Nigerian books:** ❌ Does NOT cover SportyBet, Bet9ja, BetKing, or any Nigeria-specific bookmaker
- **Markets:** 1X2, Totals, Spreads, Player Props, Futures
- **Features:** Pre-match + live odds, historical odds, closing line value
- **Free tier:** 500 requests/month, 20 sports
- **Pricing:** $20/mo (Starter), $50/mo (Pro), $200/mo (Enterprise)
- **Use for:** Global odds comparison, value detection against sharp books (Pinnacle, Bet365)

### Sportmonks
- **Coverage:** Global football data + odds from select bookmakers
- **Nigerian books:** ❌ Not covered
- **Pricing:** $49/mo+
- **Use for:** Football statistics, match data (not Nigerian odds)

### Odds-API.io
- **Coverage:** 265+ bookmakers, 34 sports
- **Nigerian books:** ❌ Not confirmed
- **Free tier:** 100 requests/hr
- **Pricing:** From £49/mo
- **Use for:** Broad odds comparison

### SharpAPI
- **Coverage:** Normalized odds from 44+ sportsbooks
- **Nigerian books:** ❌ Not covered
- **Use for:** US/EU focused odds comparison

---

## C. Third-Party / Unofficial APIs

### NaijaBet-Api (github.com/jayteealao/NaijaBet_Api)
- **Type:** Unofficial Python library (scraping)
- **Coverage:** Bet9ja, BetKing, NairaBet — 1X2 and Double Chance odds
- **Status:** ⚠️ Unofficial, may break when sites update
- **Markets:** 1X2, Double Chance only
- **Use for:** MVP odds comparison for Nigerian books
- **Risk:** High — scraping can break anytime

### Convert Bet Codes API (convertbetcodes.com)
- **Type:** Third-party API
- **Coverage:** Bet9ja, SportyBet, Betway, 1xBet, Paripesa, Bestbet, Hollywoodbet, 22Bet, and more
- **Features:**
  - Convert booking codes between bookmakers
  - Retrieve odds for specific matches
  - List available markets
  - Generate booking codes
- **Authentication:** API key (contact them)
- **Pricing:** Unknown — contact required
- **Use for:** ⭐ **MVP CORE** — booking code generation and conversion

### BetCode App (Google Play)
- **Type:** Mobile app
- **Coverage:** Bet9ja, SportyBet, 22Bet, Betway, and more
- **Features:** Convert booking codes between bookmakers
- **Rating:** 4.3/5 (897 reviews)
- **Use for:** Reference implementation, not direct integration

### Betloy (betloy.com)
- **Type:** Free web tool + API
- **Coverage:** 100+ bookmakers including all major Nigerian books
- **Features:** Free bet code conversion
- **Use for:** Free alternative to Convert Bet Codes API

---

## D. Bet-Slip / Booking Code Capabilities

### How Booking Codes Work in Nigeria

All major Nigerian bookmakers support booking codes:

```
User selects matches on bookmaker website/app
    ↓
Bookmaker generates booking code (e.g., "ABC123")
    ↓
User shares code with friend or betting shop
    ↓
Friend enters code on same bookmaker
    ↓
Betslip loads with pre-filled selections
    ↓
User enters stake and places bet
```

### Booking Code Format by Bookmaker

| Bookmaker | Code Format | Length | Example |
|-----------|-------------|--------|---------|
| SportyBet | Alphanumeric | 8-10 chars | `250824A1B2` |
| Bet9ja | Numeric | 8-10 digits | `4467373446` |
| BetKing | Alphanumeric | 8-10 chars | `BK12345678` |
| 1xBet | Alphanumeric | 6-8 chars | `1X1234` |
| Betway | Alphanumeric | 8-10 chars | `BW12345678` |

### What We Can Build (MVP)

```
AI Agent selects games
    ↓
Find matching events on Convert Bet Codes API
    ↓
Generate booking code for target bookmaker
    ↓
Show user: "Your SportyBet booking code: 250824A1B2"
    ↓
User opens SportyBet app
    ↓
Enters booking code
    ↓
Betslip loads
    ↓
User enters stake and places bet
```

---

## E. Browser Automation Feasibility

### Bet9ja
- **Protection:** Standard web protection
- **Feasibility:** ⚠️ Possible but fragile
- **Risk:** Site updates break automation regularly
- **Recommendation:** Avoid for MVP

### SportyBet
- **Protection:** Cloudflare + anti-bot
- **Feasibility:** ❌ Very difficult
- **Risk:** High — aggressive bot detection
- **Recommendation:** Avoid

### BetKing
- **Protection:** Cloudflare (confirmed by NaijaBet-Api)
- **Feasibility:** ❌ Requires Playwright browser automation
- **Risk:** High — Cloudflare challenges
- **Recommendation:** Avoid

### 1xBet
- **Protection:** Moderate
- **Feasibility:** ⚠️ Possible
- **Risk:** Medium — site changes frequently
- **Recommendation:** Only if needed

**Recommendation:** Do NOT build the MVP around browser automation. Use booking codes instead.

---

## F. Recommended Integration Strategy

### Level 1 — Official API ❌ Not Available
No Nigerian bookmaker provides a public developer API.

### Level 2 — Authorized Integration ⚠️ Limited
1xBet affiliate API exists but only for tracking, not odds/bet placement.

### Level 3 — Booking Code Integration ✅ BEST OPTION
Use Convert Bet Codes API + Betloy to:
1. Retrieve odds from Nigerian bookmakers
2. Generate booking codes
3. Convert codes between bookmakers

### Level 4 — Browser Automation ❌ Not Recommended
Too fragile, too many anti-bot protections, breaks frequently.

---

## G. Recommended Architecture

```
┌─────────────────────────────────────────────────────┐
│                  AI Betting Agent                    │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Game Finder  │  │ Value Engine │  │ Risk Mgr  │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘ │
│         │                │                │        │
│  ┌──────┴────────────────┴────────────────┴─────┐  │
│  │           Betslip Builder                     │  │
│  └──────────────────┬───────────────────────────┘  │
│                     │                              │
│  ┌──────────────────┴───────────────────────────┐  │
│  │        Booking Code Generator                 │  │
│  │  (Convert Bet Codes API / Betloy)             │  │
│  └──────────────────┬───────────────────────────┘  │
│                     │                              │
└─────────────────────┼──────────────────────────────┘
                      │
                      ↓
              ┌───────────────┐
              │  User Reviews │
              │  Booking Code │
              │  Opens App    │
              │  Places Bet   │
              └───────────────┘
```

### Data Flow

```
Our Prediction Engine
        ↓
Value Detection (edge > 5%)
        ↓
Risk Assessment (max stake, exposure)
        ↓
Betslip Construction (1-10 legs)
        ↓
Booking Code Generation (Convert Bet Codes API)
        ↓
User Presentation (code + deep link)
        ↓
User Approval
        ↓
User Opens Bookmaker
        ↓
Betslip Loads
        ↓
User Places Actual Wager
```

---

## H. Odds Infrastructure

### Recommended Setup

| Source | Purpose | Cost |
|--------|---------|------|
| **The Odds API** | Global odds (Pinnacle, Bet365, etc.) for value detection | $20-50/mo |
| **Convert Bet Codes API** | Nigerian bookmaker odds + booking codes | Contact |
| **Betloy** | Free backup for booking code conversion | Free |
| **NaijaBet-Api** | Unofficial Nigerian odds (backup) | Free |
| **football-data.org** | Match data + fixtures | Free tier |

### Odds Storage Schema

```sql
CREATE TABLE odds_cache (
  id UUID PRIMARY KEY,
  bookmaker TEXT NOT NULL,
  event_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  odds NUMERIC(6,2) NOT NULL,
  implied_prob NUMERIC(5,4),
  timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  event_name TEXT,
  league TEXT,
  kickoff_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## I. Betslip Validation Rules

Before generating a booking code, verify:

1. ✅ Event still exists on the bookmaker
2. ✅ Match has not started
3. ✅ Market is still available
4. ✅ Selection is still available
5. ✅ Odds are still available (within 5% of captured odds)
6. ✅ Combination is valid (max legs, min odds)
7. ✅ Bookmaker is available (not down for maintenance)

If any check fails:
- ❌ Stop and notify user
- ❌ Never silently substitute
- ❌ Never use stale odds

---

## J. Risk Controls

| Control | Default | User Configurable |
|---------|---------|-------------------|
| Max stake per bet | ₦10,000 | ✅ Yes |
| Max daily exposure | ₦50,000 | ✅ Yes |
| Max bets per day | 5 | ✅ Yes |
| Min edge required | 5% | ✅ Yes |
| Max legs per accumulator | 10 | ✅ Yes |
| Confirmation for stakes > ₦5,000 | Yes | ✅ Yes |
| "Guaranteed win" claims | ❌ Never | ❌ No |

---

## K. Audit Trail Schema

```sql
CREATE TABLE agent_audit_log (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,  -- 'recommendation', 'betslip_created', 'code_generated', 'approved', 'rejected'
  selections JSONB NOT NULL,
  odds_captured JSONB,
  booking_code TEXT,
  bookmaker TEXT,
  model_probability NUMERIC(5,4),
  edge NUMERIC(5,4),
  stake NUMERIC(10,2),
  potential_return NUMERIC(10,2),
  status TEXT NOT NULL,  -- 'pending', 'approved', 'rejected', 'expired', 'placed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## L. Development Complexity

| Component | Complexity | Time Estimate |
|-----------|------------|---------------|
| Game Finder (from our data) | Low | 1-2 days |
| Value Engine (from our models) | Low | 1-2 days |
| Betslip Builder | Medium | 3-5 days |
| Booking Code Integration | Medium | 3-5 days |
| User Approval Flow | Low | 2-3 days |
| Risk Controls | Medium | 2-3 days |
| Audit Trail | Low | 1-2 days |
| Odds Cache + Refresh | Medium | 3-5 days |
| **Total MVP** | | **~3-4 weeks** |

---

## M. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Convert Bet Codes API breaks | High | Betloy as backup, NaijaBet-Api as fallback |
| Nigerian bookmaker odds change fast | Medium | Refresh odds every 5 minutes, validate before code generation |
| Booking codes expire | Medium | Generate fresh codes on demand, warn user |
| Bookmaker site changes | High | Multiple data sources, graceful degradation |
| Regulatory changes | Medium | Monitor Nigerian betting regulations |
| User loses money | High | Clear disclaimers, never guarantee wins, risk controls |

---

## N. Recommended MVP (V1)

### Phase 1: Intelligence (Week 1-2)
- ✅ Game finder from our 79-league database
- ✅ Value engine using our ensemble model + The Odds API
- ✅ Risk assessment with user limits
- ✅ AI explanation of each selection

### Phase 2: Betslip (Week 2-3)
- ✅ Betslip builder (1-10 legs)
- ✅ Odds validation
- ✅ Booking code generation (Convert Bet Codes API)
- ✅ Multi-bookmaker support

### Phase 3: User Flow (Week 3-4)
- ✅ User review screen
- ✅ Approval/rejection flow
- ✅ Booking code display
- ✅ Deep link to bookmaker app
- ✅ Audit trail

### Phase 4: Polish (Week 4)
- ✅ Risk controls
- ✅ Daily exposure tracking
- ✅ Performance analytics
- ✅ Error handling

### What V1 Will NOT Do
- ❌ Auto-place bets (user always confirms)
- ❌ Browser automation
- ❌ Direct bookmaker API integration
- ❌ Real-time live betting (pre-match only)

---

## O. Architecture Summary

```
┌──────────────────────────────────────────────────┐
│                 ODDLY Platform                    │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ Prediction │  │   Odds     │  │   User     │ │
│  │  Engine    │  │  Engine    │  │  Service   │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │
│        │               │               │        │
│  ┌─────┴───────────────┴───────────────┴──────┐ │
│  │              AI Betting Agent               │ │
│  │  • Analyze games                            │ │
│  │  • Compare odds across bookmakers           │ │
│  │  • Identify value                           │ │
│  │  • Build proposed betslip                   │ │
│  │  • Generate booking code                    │ │
│  │  • Present to user for approval             │ │
│  └─────────────────────┬──────────────────────┘ │
│                        │                         │
└────────────────────────┼─────────────────────────┘
                         │
                         ↓
              ┌─────────────────────┐
              │   User Approves     │
              │   Booking Code      │
              │   Opens Bookmaker   │
              │   Places Bet        │
              └─────────────────────┘
```

---

## P. Next Steps

1. **Contact Convert Bet Codes API** — Get API key and documentation
2. **Test Betloy API** — Verify free booking code generation
3. **Build game finder** — Query our 79-league database for today's matches
4. **Build value engine** — Compare our model probabilities against bookmaker odds
5. **Design betslip UI** — User review + approval flow
6. **Implement booking code generation** — Integrate with Convert Bet Codes API
7. **Add risk controls** — Stake limits, exposure tracking
8. **Build audit trail** — Track every recommendation and outcome
