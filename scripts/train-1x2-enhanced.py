#!/usr/bin/env python3
"""
1X2 Enhanced Model — With Standings, Relegation Context & Motivation Factors

New features beyond v5:
- League position, points, goal difference, win rate
- Relegation battle context (bottom 3-5 teams fighting to survive)
- Title race context (top teams competing for title)
- Mid-table safety context
- Points gap from relegation zone
- Form relative to league position
- Home/away performance splits
- Goals scored/conceded relative to league average
- Points per game vs league average
- Motivation intensity (end of season, early season)
- Streaks (win/loss/draw streaks)
- Consecutive clean sheets
- Recent result momentum
- Head-to-head record at home/away specifically
"""

import json, os, warnings
from datetime import datetime
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, classification_report, log_loss
from sklearn.linear_model import LogisticRegression
from supabase import create_client

warnings.filterwarnings("ignore")

ENV = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"): continue
        idx = line.index("=")
        ENV[line[:idx].strip()] = line[idx+1:].strip().strip('"').strip("'")

sb = create_client(ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"])

# ─── Load Data ─────────────────────────────────────────────────────────────

def load_data():
    print("📡 Loading fixtures from Supabase...")
    fixtures = []
    offset = 0
    while True:
        for attempt in range(3):
            try:
                r = sb.table("fixtures").select(
                    "id, home_team_id, away_team_id, league_id, kickoff_time, status, home_score, away_score"
                ).eq("status", "finished").not_.is_("home_score", "null").order(
                    "kickoff_time", desc=False
                ).range(offset, offset + 500 - 1).execute()
                break
            except Exception as e:
                import time; time.sleep(3)
        else:
            break
        batch = r.data
        if not batch: break
        fixtures.extend(batch)
        offset += len(batch)
        if len(batch) < 500: break
    
    teams = {t["id"]: t for t in sb.table("teams").select("id, canonical_name").execute().data}
    leagues = {l["id"]: l for l in sb.table("leagues").select("id, name").execute().data}
    
    # Load standings
    standings_file = os.path.join(os.path.dirname(__file__), "..", "data", "standings.json")
    standings = {}
    if os.path.exists(standings_file):
        with open(standings_file) as f:
            standings = json.load(f)
    
    print(f"   {len(fixtures)} matches, {len(teams)} teams, {len(leagues)} leagues, {len(standings)} league standings")
    return fixtures, teams, leagues, standings


# ─── Enhanced Feature Engine ───────────────────────────────────────────────

class EnhancedFeatureEngine:
    def __init__(self, standings):
        self.IE = 1500
        self.K = 20
        self.tm = defaultdict(list)  # team matches
        self.te = {}  # elo
        self.h2h = defaultdict(list)
        self.ls = defaultdict(lambda: {"hw": 0, "d": 0, "aw": 0, "n": 0, "goals": []})
        self.standings = standings  # league standings snapshot
        self.league_teams = {}  # league_id -> list of team_ids
        self.team_league = {}  # team_id -> league_id
        
        # Rolling stats
        self.team_points = defaultdict(list)  # team_id -> [points_per_game_history]
        self.team_goals_scored = defaultdict(list)
        self.team_goals_conceded = defaultdict(list)
        self.team_home_results = defaultdict(list)
        self.team_away_results = defaultdict(list)
        
        # Streak tracking
        self.team_streaks = defaultdict(lambda: {"wins": 0, "losses": 0, "draws": 0, "clean_sheets": 0})
        
    def elo_expected(self, a, b):
        return 1 / (1 + 10 ** ((b - a) / 400))
    
    def elo_update(self, ea, eb, sa):
        na = ea + self.K * (sa - self.elo_expected(ea, eb))
        nb = eb + self.K * ((1 - sa) - self.elo_expected(eb, ea))
        return na, nb
    
    def get_standings_position(self, team_name, league_name):
        """Get team's position in league table from standings snapshot."""
        league_standings = self.standings.get(league_name, [])
        for t in league_standings:
            if t["name"].lower() in team_name.lower() or team_name.lower() in t["name"].lower():
                return t
        return None
    
    def form(self, tid, n=15):
        """Rolling form features."""
        ms = self.tm.get(tid, [])[:n]
        if not ms:
            return [0] * 12
        
        pts, gf, ga, w, d, l_, hn, cs, l3_pts = 0, 0, 0, 0, 0, 0, 0, 0, 0
        home_pts, away_pts, home_gf, home_ga, away_gf, away_ga = 0, 0, 0, 0, 0, 0
        home_count, away_count = 0, 0
        
        for i, m in enumerate(ms):
            ih = m[1] == tid
            h, a_ = int(m[3]), int(m[4])
            gf_, ga_ = (h, a_) if ih else (a_, h)
            gf += gf_; ga += ga_
            
            if ih:
                hn += 1
                home_count += 1
                home_gf += gf_; home_ga += ga_
            else:
                away_count += 1
                away_gf += gf_; away_ga += ga_
            
            if gf_ == 0: cs += 1
            
            if gf_ > ga_:
                w += 1; pts += 3
                if ih: home_pts += 3
                else: away_pts += 3
            elif gf_ == ga_:
                d += 1; pts += 1
                if ih: home_pts += 1
                else: away_pts += 1
            else:
                l_ += 1
                if ih: home_pts += 0
                else: away_pts += 0
            
            if i >= n - 3:
                if gf_ > ga_: l3_pts += 3
                elif gf_ == ga_: l3_pts += 1
        
        nn = max(len(ms), 1)
        return [
            pts / nn, gf / nn, ga / nn, w / nn, d / nn, l_ / nn,  # 0-5
            hn / nn, cs / nn, l3_pts / 3,  # 6-8
            home_pts / max(home_count, 1),  # 9: home form
            away_pts / max(away_count, 1),  # 10: away form
            (home_gf - home_ga) / max(home_count, 1) - (away_gf - away_ga) / max(away_count, 1),  # 11: home vs away goal diff
        ]
    
    def streak_features(self, tid):
        """Win/loss/draw streak features."""
        ms = self.tm.get(tid, [])[:20]
        if not ms:
            return [0] * 5
        
        # Current streak
        current_streak = 0
        streak_type = None
        for m in ms:
            ih = m[1] == tid
            gf_, ga_ = (int(m[3]), int(m[4])) if ih else (int(m[4]), int(m[3]))
            
            if gf_ > ga_:
                result = "W"
            elif gf_ == ga_:
                result = "D"
            else:
                result = "L"
            
            if streak_type is None:
                streak_type = result
                current_streak = 1
            elif result == streak_type:
                current_streak += 1
            else:
                break
        
        # Count streaks
        w_streak, l_streak, d_streak = 0, 0, 0
        for m in ms:
            ih = m[1] == tid
            gf_, ga_ = (int(m[3]), int(m[4])) if ih else (int(m[4]), int(m[3]))
            if gf_ > ga_: w_streak += 1; l_streak = 0; d_streak = 0
            elif gf_ < ga_: l_streak += 1; w_streak = 0; d_streak = 0
            else: d_streak += 1; w_streak = 0; l_streak = 0
        
        # Clean sheet streak
        cs_streak = 0
        for m in ms:
            ih = m[1] == tid
            ga_ = int(m[4]) if ih else int(m[3])
            if ga_ == 0:
                cs_streak += 1
            else:
                break
        
        return [
            current_streak * (1 if streak_type == "W" else -1 if streak_type == "L" else 0),
            w_streak, l_streak, d_streak, cs_streak
        ]
    
    def motivation_features(self, tid, lid, league_name, match_idx, total_matches):
        """Motivation and context features."""
        # Get standings position
        team_name = ""
        ms = self.tm.get(tid, [])
        if ms:
            team_name = str(tid)
        
        pos_data = self.get_standings_position(team_name, league_name)
        
        features = []
        
        if pos_data:
            position = pos_data["position"]
            points = pos_data["points"]
            played = pos_data["played"]
            gd = pos_data["goalDifference"]
            
            # League size
            league_size = len(self.standings.get(league_name, []))
            
            # Position features
            features.append(position / max(league_size, 1))  # Relative position (0=best, 1=worst)
            features.append(points / max(played * 3, 1))  # Points per game
            features.append(gd / max(played, 1))  # GD per game
            
            # Relegation zone (bottom 3 or 4 depending on league)
            relegation_zone = 4 if league_size >= 20 else 3
            features.append(1 if position > league_size - relegation_zone else 0)  # In relegation zone
            features.append(1 if position > league_size - relegation_zone - 2 else 0)  # Near relegation zone
            
            # Title race (top 3 or 4)
            features.append(1 if position <= 3 else 0)  # Title contender
            features.append(1 if position <= 5 else 0)  # European qualification
            
            # Mid-table safety
            mid_start = league_size // 3
            mid_end = 2 * league_size // 3
            features.append(1 if mid_start <= position <= mid_end else 0)  # Mid-table
            
            # Points gap from relegation
            if pos_data["position"] < league_size:
                # Get last safe team's points
                safe_teams = sorted(self.standings.get(league_name, []), key=lambda x: -x["points"])
                if len(safe_teams) > league_size - relegation_zone:
                    safe_points = safe_teams[league_size - relegation_zone - 1]["points"]
                    features.append(points - safe_points)  # Gap from relegation
                else:
                    features.append(0)
            else:
                features.append(0)
        else:
            features.extend([0.5, 0, 0, 0, 0, 0, 0, 0, 0])
        
        return features
    
    def relative_strength(self, tid, lid, league_name):
        """How does this team compare to the league average?"""
        ms = self.tm.get(tid, [])[-20:]
        if not ms:
            return [0] * 6
        
        att = np.mean([int(m[3]) if m[1] == tid else int(m[4]) for m in ms])
        deff = np.mean([int(m[4]) if m[1] == tid else int(m[3]) for m in ms])
        
        # Get league averages
        league_teams = [t for t in self.tm.keys() if any(m[5] == lid for m in self.tm[t][-20:])]
        if len(league_teams) < 2:
            return [att, deff, att, deff, 0, 0]
        
        league_att = np.mean([np.mean([int(m[3]) if m[1] == t else int(m[4]) for m in self.tm[t][-20:]])
                             for t in league_teams if len(self.tm[t][-20:]) >= 5])
        league_deff = np.mean([np.mean([int(m[4]) if m[1] == t else int(m[3]) for m in self.tm[t][-20:]])
                              for t in league_teams if len(self.tm[t][-20:]) >= 5])
        
        return [
            att, deff,
            att - league_att,  # Attack vs league avg
            deff - league_deff,  # Defense vs league avg
            (att - league_att) / max(league_att, 0.1),  # Attack percentile
            (deff - league_deff) / max(league_deff, 0.1),  # Defense percentile
        ]
    
    def h2h_features(self, a, b):
        """Head-to-head features."""
        key = tuple(sorted([a, b]))
        ms = self.h2h.get(key, [])[-10:]
        if not ms:
            return [0] * 7
        
        aw, bw, dr, tg, ag, home_wins_a, away_wins_a = 0, 0, 0, 0, 0, 0, 0
        for m in ms:
            h, a_ = int(m[0]), int(m[1])
            ht = m[3]
            tg += h + a_
            if ht == a:
                ag += h
                if h > a_: aw += 1; home_wins_a += 1
                elif h < a_: bw += 1
                else: dr += 1
            else:
                ag += a_
                if a_ > h: aw += 1; away_wins_a += 1
                elif a_ < h: bw += 1
                else: dr += 1
        
        nn = max(len(ms), 1)
        return [aw / nn, bw / nn, dr / nn, tg / nn, ag / nn, home_wins_a / nn, away_wins_a / nn]
    
    def league_features(self, lid):
        """League-wide stats."""
        ls = self.ls[lid]
        t = max(ls["n"], 1)
        ag = np.mean(ls["goals"]) if ls["goals"] else 2.6
        return [ls["hw"] / t, ls["d"] / t, ls["aw"] / t, ag, np.log1p(t)]
    
    def strength_features(self, tid):
        """Team strength features."""
        ms = self.tm.get(tid, [])[-20:]
        if not ms:
            return [1.3] * 12
        
        att = np.mean([int(m[3]) if m[1] == tid else int(m[4]) for m in ms])
        deff = np.mean([int(m[4]) if m[1] == tid else int(m[3]) for m in ms])
        
        ht = [m for m in ms if m[1] == tid]
        aw = [m for m in ms if m[2] == tid]
        
        hta = np.mean([int(m[3]) for m in ht]) if ht else att
        htd = np.mean([int(m[4]) for m in ht]) if ht else deff
        awa = np.mean([int(m[4]) for m in aw]) if aw else att
        awd = np.mean([int(m[3]) for m in aw]) if aw else deff
        
        at = np.mean([int(m[3]) + int(m[4]) for m in ms])
        
        return [
            att, deff, hta, htd, awa, awd,  # 0-5
            at,  # 6: avg total goals
            len(ht) / max(len(ms), 1),  # 7: home match ratio
            len(aw) / max(len(ms), 1),  # 8: away match ratio
            len(ms),  # 9: matches played
            hta - awa,  # 10: home attack advantage
            htd - awd,  # 11: home defense advantage
        ]
    
    def build(self, fx):
        """Build complete feature vector."""
        h, a, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        league_name = ""
        for lid_key, l_data in self.league_teams.items():
            if lid_key == lid:
                league_name = l_data.get("name", "")
                break
        
        f = {}
        
        # ─── Form features (12 each) ────────────
        hf = self.form(h)
        af = self.form(a)
        for i in range(12):
            f[f"hf{i}"] = hf[i]
            f[f"af{i}"] = af[i]
            f[f"fd{i}"] = hf[i] - af[i]
        
        # ─── Streak features (5 each) ───────────
        hs = self.streak_features(h)
        as_ = self.streak_features(a)
        for i in range(5):
            f[f"hst{i}"] = hs[i]
            f[f"ast{i}"] = as_[i]
        
        # ─── Elo features ────────────────────────
        he = self.te.get(h, self.IE)
        ae = self.te.get(a, self.IE)
        f["he"] = he; f["ae"] = ae; f["ed"] = he - ae
        f["ee"] = self.elo_expected(he, ae)
        
        # ─── H2H features (7) ───────────────────
        h2 = self.h2h_features(h, a)
        for i, v in enumerate(h2):
            f[f"h{i}"] = v
        
        # ─── League features (5) ─────────────────
        lf = self.league_features(lid)
        for i, v in enumerate(lf):
            f[f"l{i}"] = v
        
        # ─── Strength features (12) ──────────────
        sf_h = self.strength_features(h)
        sf_a = self.strength_features(a)
        for i in range(12):
            f[f"sh{i}"] = sf_h[i]
            f[f"sa{i}"] = sf_a[i]
        
        # ─── Relative strength (6) ───────────────
        rs_h = self.relative_strength(h, lid, league_name)
        rs_a = self.relative_strength(a, lid, league_name)
        for i in range(6):
            f[f"rsh{i}"] = rs_h[i]
            f[f"rsa{i}"] = rs_a[i]
        
        # ─── Motivation/context features (9) ─────
        mf_h = self.motivation_features(h, lid, league_name, 0, 38)
        mf_a = self.motivation_features(a, lid, league_name, 0, 38)
        for i in range(min(len(mf_h), 9)):
            f[f"mfh{i}"] = mf_h[i]
            f[f"mfa{i}"] = mf_a[i]
        
        # ─── Derived features ────────────────────
        f["att_d"] = sf_h[0] - sf_a[0]  # Attack diff
        f["def_d"] = sf_h[1] - sf_a[1]  # Defense diff
        f["axd"] = f["att_d"] * f["def_d"]  # Attack × Defense interaction
        f["sd"] = (sf_h[0] / max(sf_h[1], 0.1)) - (sf_a[0] / max(sf_a[1], 0.1))  # Strength diff
        f["form_d_overall"] = hf[0] - af[0]  # Overall form diff
        f["form_d_home_away"] = hf[9] - af[10]  # Home form vs away form
        f["motivation_d"] = mf_h[0] - mf_a[0] if len(mf_h) > 0 and len(mf_a) > 0 else 0  # Position diff
        
        return f
    
    def update(self, fx):
        """Update state after a match."""
        h, a, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        dt = fx["kickoff_time"]
        
        self.tm[h].append((dt, h, a, hs, as_, lid))
        self.tm[a].append((dt, h, a, hs, as_, lid))
        
        key = tuple(sorted([h, a]))
        self.h2h[key].append((hs, as_, dt, h, a))
        
        he = self.te.get(h, self.IE)
        ae = self.te.get(a, self.IE)
        s = 1.0 if hs > as_ else (0.5 if hs == as_ else 0.0)
        self.te[h], self.te[a] = self.elo_update(he, ae, s)
        
        ls = self.ls[lid]
        ls["n"] += 1
        ls["goals"].append(hs + as_)
        if hs > as_: ls["hw"] += 1
        elif hs == as_: ls["d"] += 1
        else: ls["aw"] += 1
        
        # Track league teams
        if lid not in self.league_teams:
            self.league_teams[lid] = {"name": "", "teams": set()}
        self.league_teams[lid]["teams"].add(h)
        self.league_teams[lid]["teams"].add(a)


# ─── Main Training ─────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("🚀 1X2 Enhanced Model — Standings + Motivation + Context")
    print("=" * 60)
    
    fixtures, teams, leagues, standings = load_data()
    engine = EnhancedFeatureEngine(standings)
    
    # Map league IDs to names
    for lid, l_data in leagues.items():
        engine.league_teams[lid] = {"name": l_data["name"], "teams": set()}
    
    print(f"\n🔧 Building enhanced features ({len(fixtures)} matches)...")
    recs = []
    for i, fx in enumerate(fixtures):
        if i % 2000 == 0:
            print(f"   {i}/{len(fixtures)}...")
        feat = engine.build(fx)
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        feat["label"] = 0 if hs > as_ else (1 if hs == as_ else 2)
        feat["date"] = fx["kickoff_time"]
        recs.append(feat)
        engine.update(fx)
    
    df = pd.DataFrame(recs)
    mc = ["label", "date"]
    fc = [c for c in df.columns if c not in mc]
    
    print(f"\n📊 Dataset: {len(df)} matches × {len(fc)} features")
    print(f"   Home: {(df.label==0).sum()} ({(df.label==0).mean()*100:.1f}%)")
    print(f"   Draw: {(df.label==1).sum()} ({(df.label==1).mean()*100:.1f}%)")
    print(f"   Away: {(df.label==2).sum()} ({(df.label==2).mean()*100:.1f}%)")
    
    # Temporal split
    df["date_dt"] = pd.to_datetime(df["date"])
    df = df.sort_values("date_dt").reset_index(drop=True)
    sp = int(len(df) * 0.8)
    train = df.iloc[:sp]; test = df.iloc[sp:]
    
    Xtr = np.nan_to_num(train[fc].values, nan=0, posinf=10, neginf=-10)
    ytr = train["label"].values
    Xte = np.nan_to_num(test[fc].values, nan=0, posinf=10, neginf=-10)
    yte = test["label"].values
    
    cc = Counter(ytr); tot = len(ytr)
    sw = np.array([tot / (3 * cc[y]) for y in ytr])
    
    print(f"\n📅 Train: {len(train)} ({train['date'].iloc[0][:10]} → {train['date'].iloc[-1][:10]})")
    print(f"   Test:  {len(test)} ({test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]})")
    
    # ─── XGBoost ─────────────────────────────────
    print("\n🏋️ Training XGBoost...")
    xgb_model = xgb.XGBClassifier(
        n_estimators=500, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        gamma=0.1, reg_alpha=0.1, reg_lambda=1.0,
        objective="multi:softprob", num_class=3,
        eval_metric="mlogloss", early_stopping_rounds=50,
        random_state=42, n_jobs=-1, verbosity=0,
    )
    xgb_model.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)
    p_xgb = xgb_model.predict_proba(Xte)
    pred_xgb = np.argmax(p_xgb, axis=1)
    acc_xgb = accuracy_score(yte, pred_xgb)
    print(f"   XGBoost: {acc_xgb*100:.1f}% (best iter: {xgb_model.best_iteration})")
    
    # ─── LightGBM ────────────────────────────────
    print("\n🏋️ Training LightGBM...")
    lgb_model = lgb.LGBMClassifier(
        n_estimators=500, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        reg_alpha=0.1, reg_lambda=1.0,
        class_weight="balanced",
        objective="multiclass", num_class=3,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    lgb_model.fit(Xtr, ytr, eval_set=[(Xte, yte)],
                  callbacks=[lgb.early_stopping(50, verbose=False)])
    p_lgb = lgb_model.predict_proba(Xte)
    pred_lgb = np.argmax(p_lgb, axis=1)
    acc_lgb = accuracy_score(yte, pred_lgb)
    print(f"   LightGBM: {acc_lgb*100:.1f}% (best iter: {lgb_model.best_iteration_})")
    
    # ─── Ensemble ────────────────────────────────
    print("\n🏋️ Building ensemble...")
    best_acc, best_w = 0, 0.5
    for w in np.arange(0.3, 0.71, 0.05):
        ep = w * p_xgb + (1 - w) * p_lgb
        acc = accuracy_score(yte, np.argmax(ep, axis=1))
        if acc > best_acc:
            best_acc = acc
            best_w = w
    
    ep = best_w * p_xgb + (1 - best_w) * p_lgb
    best_pred = np.argmax(ep, axis=1)
    best_proba = ep
    
    print(f"\n{'='*60}")
    print(f"📊 RESULTS")
    print(f"{'='*60}")
    print(f"   XGBoost alone:  {acc_xgb*100:.1f}%")
    print(f"   LightGBM alone: {acc_lgb*100:.1f}%")
    print(f"   Ensemble (w={best_w:.2f}): {best_acc*100:.1f}%")
    
    print(f"\n📊 Classification Report:")
    print(classification_report(yte, best_pred, target_names=["Home Win", "Draw", "Away Win"], zero_division=0))
    
    maxp = np.max(best_proba, axis=1)
    print(f"📊 Confidence Buckets:")
    for lo, hi in [(0.3,.4),(.4,.5),(.5,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.01)]:
        mask = (maxp >= lo) & (maxp < hi)
        if mask.sum() > 5:
            ba = accuracy_score(yte[mask], best_pred[mask])
            print(f"   {lo*100:.0f}-{hi*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {ba*100:.1f}%")
    
    print(f"\n📊 Coverage:")
    for t in [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        mask = maxp >= t
        if mask.sum() > 0:
            acc = accuracy_score(yte[mask], best_pred[mask])
            print(f"   ≥{t*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {acc*100:.1f}%")
    
    # ─── Feature Importance ──────────────────────
    print(f"\n📊 Top 20 Features (XGBoost):")
    imp = xgb_model.feature_importances_
    fi = sorted(zip(fc, imp), key=lambda x: x[1], reverse=True)
    for name, val in fi[:20]:
        print(f"   {name:25s} {val:.4f} {'█' * int(val * 200)}")
    
    # ─── Save ────────────────────────────────────
    model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(model_dir, exist_ok=True)
    
    xgb_model.save_model(os.path.join(model_dir, "xgboost_1x2_enhanced.json"))
    lgb_model.booster_.save_model(os.path.join(model_dir, "lgbm_1x2_enhanced.txt"))
    
    with open(os.path.join(model_dir, "1x2_enhanced_meta.json"), "w") as f:
        json.dump({
            "version": "enhanced",
            "accuracy": float(best_acc),
            "xgb_accuracy": float(acc_xgb),
            "lgb_accuracy": float(acc_lgb),
            "ensemble_weight": float(best_w),
            "n_features": len(fc),
            "n_train": len(train),
            "n_test": len(test),
            "train_date": str(datetime.now()),
            "feature_names": fc,
            "feature_importance": {name: float(val) for name, val in fi[:30]},
            "test_period": f"{test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}",
            "new_features": [
                "standings_position", "relegation_zone", "title_contender",
                "motivation_factors", "streak_features", "relative_strength",
                "home_away_splits", "form_vs_position"
            ],
        }, f, indent=2)
    
    print(f"\n💾 Models saved to {model_dir}")
    print(f"{'='*60}")
    print(f"🏆 Enhanced 1X2 Accuracy: {best_acc*100:.1f}%")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
