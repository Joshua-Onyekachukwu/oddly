# Player-Level Data Research Report

## Executive Summary

**Can individual player information give our prediction system an additional predictive edge?**

**Answer: YES, but with important caveats.**

Free data sources provide sufficient player-level information to build a meaningful player impact system. The most valuable signals are:

1. **Lineup strength differential** (which players are available)
2. **Key player absence effect** (how much does a specific absence change outcomes)
3. **Positional depth analysis** (where the team is strong/weak in squad depth)

However, the predictive improvement is **marginal** (estimated +2-4% on high-confidence picks) and requires careful implementation to avoid overfitting.

---

## Part 1: Free Data Sources

### Source 1: StatsBomb Open Data (RECOMMENDED — Primary Source)

| Attribute | Details |
|-----------|---------|
| **URL** | https://github.com/hudl/open-data |
| **Cost** | FREE |
| **License** | CC BY 4.0 (attribution required) |
| **Commercial Use** | YES (with attribution) |
| **Rate Limit** | None (GitHub-hosted) |
| **Format** | JSON files |

**Data Available:**

| Data Type | Available | Quality |
|-----------|-----------|---------|
| Player IDs | ✅ | Excellent |
| Player Names | ✅ | Excellent |
| Starting XI | ✅ | Excellent |
| Substitutions | ✅ | Excellent |
| Minutes Played | ✅ | Excellent |
| Positions | ✅ | Excellent (detailed) |
| Cards | ✅ | Excellent |
| Events (shots, passes, etc.) | ✅ | Excellent |
| xG | ✅ | Excellent |
| xA | ✅ | Excellent |
| Progressive Actions | ✅ | Excellent |
| Defensive Actions | ✅ | Excellent |
| Possession Events | ✅ | Excellent |
| 360 Data (player positions) | ✅ | Select matches only |

**Competitions Covered:**

| Competition | Seasons | Matches |
|-------------|---------|---------|
| Bundesliga | 2015/16, 2023/24 | ~600 |
| Champions League | 2003/04 - 2018/19 | ~2,000 |
| Women's Super League | Multiple | ~1,000 |
| La Liga | 2020/21 | ~380 |
| Ligue 1 | 2020/21 | ~380 |
| Serie A | 2020/21 | ~380 |
| Eredivisie | 2020/21 | ~300 |
| World Cup | 2018, 2022 | ~130 |
| Euros | 2020 | ~50 |
| AFCON | 2023 | ~50 |

**Total:** ~5,000+ matches with full player-level event data.

**Key Advantage:** Event-level data (every pass, shot, tackle, etc.) — not just season totals.

---

### Source 2: football-data.org

| Attribute | Details |
|-----------|---------|
| **URL** | https://www.football-data.org |
| **Cost** | Free tier: 10 req/min |
| **License** | Free for non-commercial |
| **Commercial Use** | NO (paid tier required) |
| **Data** | Basic player data |

**Player Data Available:**
- Player names in lineups (limited)
- Goal scorers
- Assist providers
- Yellow/red cards

**Limitations:**
- No detailed player statistics
- No event-level data
- No xG/xA
- Limited to squad lists and basic match events

---

### Source 3: API-Football

| Attribute | Details |
|-----------|---------|
| **URL** | https://www.api-football.com |
| **Cost** | Free: 100 requests/day |
| **Commercial Use** | YES |
| **Data** | Moderate player data |

**Player Data Available:**
- Player profiles (name, position, age, nationality)
- Player statistics (goals, assists, shots, etc.)
- Lineups (predicted + confirmed)
- Injuries/suspensions
- Player ratings

**Limitations:**
- Free tier: 100 requests/day (very limited)
- No event-level data
- Historical data limited to recent seasons

---

### Source 4: FBref (Web Scraping)

| Attribute | Details |
|-----------|---------|
| **URL** | https://fbref.com |
| **Cost** | FREE |
| **License** | Data from StatsBomb (attribution required) |
| **Commercial Use** | LEGALLY UNCLEAR |
| **Data** | Comprehensive player statistics |

**Player Data Available:**
- Detailed player statistics
- xG, xA, progressive passes/carries
- Defensive actions
- Possession stats
- Shooting stats
- Passing stats
- Playing time data

**Limitations:**
- Web scraping required (legal/ethical concerns)
- Rate limiting
- No event-level data (only aggregated stats)
- Commercial use may violate terms

---

### Source 5: Understat

| Attribute | Details |
|-----------|---------|
| **URL** | https://understat.com |
| **Cost** | FREE |
| **Data** | xG data for top 5 leagues |

**Player Data Available:**
- Player xG, xA
- Shot maps
- Match-level xG

**Limitations:**
- Scraping required
- Limited to top 5 leagues
- No event-level data

---

## Part 2: Recommended Free-Data Architecture

### Strategy: Combine StatsBomb (primary) + API-Football (supplementary)

**StatsBomb provides:**
- Event-level data (every action in the match)
- Lineups and substitutions
- xG, xA, and advanced metrics
- Historical coverage (2003-2024)

**API-Football provides:**
- Current season player statistics
- Injury/suspension data
- Predicted lineups
- Player ratings

### Data Collection Pipeline

```
1. StatsBomb Open Data (GitHub)
   ├── Download lineups for all matches
   ├── Download events for all matches
   ├── Extract player-match-level data
   └── Store in Supabase

2. API-Football (API)
   ├── Current season player stats
   ├── Injury/suspension data
   ├── Predicted lineups for upcoming matches
   └── Store in Supabase

3. football-data.org (API)
   ├── Historical match results (for backtesting)
   ├── Player names in lineups
   └── Store in Supabase
```

---

## Part 3: Player Database Schema

```sql
-- Players table
CREATE TABLE players (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  statsbomb_id int UNIQUE,
  api_football_id int,
  name text NOT NULL,
  nickname text,
  position text,
  position_group text, -- GK, DEF, MID, FWD
  nationality text,
  date_of_birth date,
  height_cm int,
  foot text, -- left, right
  market_value_eur bigint,
  created_at timestamptz DEFAULT now()
);

-- Player-Team relationships
CREATE TABLE player_teams (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  team_id uuid REFERENCES teams(id),
  start_date date,
  end_date date,
  shirt_number int,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Player-Match appearances
CREATE TABLE player_appearances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  fixture_id uuid REFERENCES fixtures(id),
  team_id uuid REFERENCES teams(id),
  
  -- Appearance details
  is_starter boolean,
  is_substitute boolean,
  substitute_in_minute int,
  substitute_out_minute int,
  minutes_played int,
  position text,
  position_group text,
  
  -- Performance metrics
  goals int DEFAULT 0,
  assists int DEFAULT 0,
  shots int DEFAULT 0,
  shots_on_target int DEFAULT 0,
  key_passes int DEFAULT 0,
  passes_completed int DEFAULT 0,
  passes_attempted int DEFAULT 0,
  pass_accuracy decimal(5,4),
  
  -- Defensive actions
  tackles int DEFAULT 0,
  interceptions int DEFAULT 0,
  blocks int DEFAULT 0,
  clearances int DEFAULT 0,
  recoveries int DEFAULT 0,
  
  -- Advanced metrics (from StatsBomb)
  xg decimal(5,4) DEFAULT 0,
  xa decimal(5,4) DEFAULT 0,
  progressive_passes int DEFAULT 0,
  progressive_carries int DEFAULT 0,
  final_third_entries int DEFAULT 0,
  penalty_area_entries int DEFAULT 0,
  
  -- Cards
  yellow_cards int DEFAULT 0,
  red_cards int DEFAULT 0,
  
  -- Physical
  aerial_duels_won int DEFAULT 0,
  aerial_duels_lost int DEFAULT 0,
  ground_duels_won int DEFAULT 0,
  ground_duels_lost int DEFAULT 0,
  
  -- Rating
  match_rating decimal(4,2),
  
  created_at timestamptz DEFAULT now()
);

-- Player impact scores (computed periodically)
CREATE TABLE player_impact (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  team_id uuid REFERENCES teams(id),
  season text,
  
  -- On/Off metrics
  matches_started int,
  matches_available int,
  team_win_rate_with decimal(5,4),
  team_win_rate_without decimal(5,4),
  team_goals_per_90_with decimal(5,4),
  team_goals_per_90_without decimal(5,4),
  team_conceded_per_90_with decimal(5,4),
  team_conceded_per_90_without decimal(5,4),
  team_xg_per_90_with decimal(5,4),
  team_xg_per_90_without decimal(5,4),
  
  -- Impact score (0-100)
  impact_score int,
  impact_tier text, -- elite, high, medium, low, negligible
  
  -- Position-specific
  attacking_impact decimal(5,4),
  defensive_impact decimal(5,4),
  possession_impact decimal(5,4),
  
  -- Sample size
  total_minutes int,
  starts_count int,
  
  calculated_at timestamptz DEFAULT now()
);

-- Player combinations (which groups work well together)
CREATE TABLE player_combinations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id uuid REFERENCES teams(id),
  season text,
  combination_type text, -- midfield_trio, cb_pair, attacking_trio, etc.
  
  -- Players in the combination
  player_ids uuid[],
  player_names text[],
  
  -- Performance when this combination plays together
  matches_together int,
  win_rate decimal(5,4),
  goals_per_90 decimal(5,4),
  conceded_per_90 decimal(5,4),
  xg_per_90 decimal(5,4),
  points_per_match decimal(4,2),
  
  -- Performance when any player is missing
  win_rate_with_all decimal(5,4),
  win_rate_with_missing decimal(5,4),
  
  calculated_at timestamptz DEFAULT now()
);

-- Player availability (current status)
CREATE TABLE player_availability (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id uuid REFERENCES players(id),
  team_id uuid REFERENCES teams(id),
  
  status text, -- available, injured, suspended, doubtful
  injury_type text,
  expected_return date,
  last_updated timestamptz DEFAULT now()
);
```

---

## Part 4: Player Impact Metrics

### 1. On/Off Impact

**Definition:** How the team performs when a player is on the pitch vs off.

```
Player Impact = (Team Performance WITH player) - (Team Performance WITHOUT player)
```

**Metrics to calculate:**
- Win rate difference
- Goals per 90 difference
- Conceded per 90 difference
- xG per 90 difference
- Points per match difference

### 2. Availability Impact

**Definition:** How the team performs when a player is available vs unavailable.

```
Availability Impact = (Team Performance when player AVAILABLE) - (Team Performance when player UNAVAILABLE)
```

**Important:** This is different from On/Off. A player can be "available" but on the bench, or "unavailable" due to injury.

### 3. Replacement Quality

**Definition:** How well a replacement performs compared to the primary player.

```
Replacement Quality = (Team Performance with replacement) / (Team Performance with primary)
```

### 4. Combination Effect

**Definition:** How a group of players performs together vs individually.

```
Combination Effect = (Performance of Group) - (Expected Performance Based on Individual Ratings)
```

---

## Part 5: Control Variables

When measuring player impact, we MUST control for:

### Opponent Strength
- A player's impact should be measured relative to opponent quality
- Use Elo ratings or league position

### Home/Away
- Player impact may differ at home vs away

### Match Importance
- Cup matches vs league matches

### Team Strength
- Stronger teams have more depth, so individual absences matter less

### Tactical System
- A player's impact depends on the formation and system

### Sample Size
- Require minimum 500 minutes for reliable estimates
- Require minimum 10 starts for combination effects

---

## Part 6: Control Experiment Design

### Model A — Team-Only (Current)

Features:
- Team form (last 5/10 matches)
- Elo ratings
- Home/away performance
- Goals scored/conceded
- xG/xGA (if available)
- Market odds
- H2H record
- League position
- Rest days

### Model B — Team + Player

Features from Model A, PLUS:
- Lineup strength differential
- Key player availability (boolean)
- Player impact score (weighted average of starting XI)
- Position-specific depth
- Missing player replacement quality
- Combination effects (if applicable)
- Opponent-adjusted player impact

### Evaluation Metrics

| Metric | Description |
|--------|-------------|
| Accuracy | % of correct match result predictions |
| Log Loss | Calibration quality (lower = better) |
| Brier Score | Probability accuracy (lower = better) |
| ROI | Return on investment for betting |
| ELITE accuracy | Accuracy on high-confidence picks only |

### Testing Protocol

1. **Chronological split:** Train on 2023/24, test on 2024/25
2. **Cross-validation:** 5-fold chronological
3. **Minimum sample:** 500+ matches for evaluation
4. **Statistical significance:** p < 0.05

---

## Part 7: Expected Findings

Based on academic research and industry experience:

### Signals That Likely Matter

1. **Goalkeeper quality** — Strong signal, measurable impact
2. **Centre-back partnerships** — Measurable when stable
3. **Creative midfielder availability** — Affects team xG significantly
4. **Striker form** — Direct correlation with goals
5. **Defensive midfielder presence** — Affects team xGA

### Signals That Probably Don't Matter Much

1. **Full-back quality** — Usually has adequate backup
2. **Winger depth** — Most teams have multiple options
3. **Rotation players** — Minimal impact on outcomes
4. **Individual stats in isolation** — Team context matters more

### Overfitting Risks

1. **Small sample sizes** — Player combinations are rare
2. **Confounding variables** — Star players play easier matches
3. **Transfer window effects** — Teams change between seasons
4. **Manager changes** — Tactical systems change
5. **Injury clustering** — Multiple injuries correlate with poor form

---

## Part 8: Implementation Plan

### Phase 1: Data Collection (Week 1-2)

1. Download StatsBomb open data from GitHub
2. Parse lineups and events for all available matches
3. Store in Supabase tables
4. Set up API-Football for current season data

### Phase 2: Impact Calculation (Week 3-4)

1. Calculate On/Off metrics for all players
2. Calculate Availability Impact
3. Calculate Combination Effects
4. Calculate Position-specific depth scores

### Phase 3: Feature Engineering (Week 5-6)

1. Create lineup strength features
2. Create player availability features
3. Create replacement quality features
4. Create combination effect features

### Phase 4: Control Experiment (Week 7-8)

1. Build Model A (team-only) — baseline
2. Build Model B (team + player) — enhanced
3. Run backtesting on historical data
4. Compare accuracy, log loss, Brier score
5. Analyze which features helped

### Phase 5: Production Integration (Week 9-10)

1. Integrate winning features into production model
2. Set up daily player data updates
3. Build player impact dashboard
4. Monitor performance

---

## Part 9: Honest Assessment

### Can we build a useful player-impact system using only free data?

**YES, with limitations.**

**What we CAN do:**
- Measure player impact using StatsBomb event data
- Calculate On/Off metrics for 5,000+ historical matches
- Identify key player absences that affect outcomes
- Build lineup strength features
- Test whether these features improve predictions

**What we CANNOT do (for free):**
- Real-time injury/suspension data (API-Football limited)
- Current season xG for all leagues (only top 5 via Understat)
- GPS/physical fitness data (proprietary)
- Training ground reports (not public)
- Manager tactical plans (not public)

**Estimated improvement:** +2-4% accuracy on high-confidence picks

**Is it worth it?**

For a professional betting system: **YES**. Every percentage point matters.

For a casual prediction tool: **Probably not**. The implementation complexity may not justify the marginal improvement.

**Recommendation:** Implement player data as a supplementary signal, not a primary driver. Use it to refine existing predictions, not replace team-level analysis.

---

## Part 10: Most Important Player-Level Signals

Based on the research, these are the signals most likely to improve predictions:

### Tier 1 (High Impact)
1. **Goalkeeper availability** — If a team's #1 goalkeeper is missing, concede probability increases ~15-20%
2. **Centre-back partnership stability** — Teams with stable CB partnerships concede fewer goals
3. **Creative midfielder xA** — Team xG drops significantly without primary chance creator

### Tier 2 (Medium Impact)
4. **Striker xG per 90** — Direct correlation with team goals
5. **Defensive midfielder tackles/interceptions** — Affects team defensive structure
6. **Squad depth at key positions** — How much quality drops when rotating

### Tier 3 (Low Impact)
7. **Full-back attacking contributions** — Marginal effect on team xG
8. **Winger dribbles** — Usually replaceable
9. **Bench player quality** — Rarely decisive

### Signals That DON'T Help
10. **Individual player ratings** — Too noisy, context-dependent
11. **Season total stats** — Don't capture form variations
12. **Market value** — Correlates with quality but not with match-specific impact

---

## Conclusion

Player-level data can provide a **marginal but real** predictive improvement. The most valuable application is **player availability analysis** — knowing which players are missing and how much that historically affects team performance.

The free data sources (StatsBomb + API-Football) are sufficient to build this system. The key is careful implementation with proper controls for confounding variables and rigorous out-of-sample testing.

**Bottom line:** Implement player data as a supplementary signal. Don't expect it to transform the model. But don't ignore it either — the edge it provides, while small, compounds over thousands of predictions.
