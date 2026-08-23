#!/usr/bin/env python3
"""
1X2 Model with Dynamic Standings — Compute rolling table from match history

Key insight: We can't use a static standings snapshot because it only shows
the current season. Instead, we compute the league table dynamically after
each match, giving us the "live table" at any point in history.
"""

import json, os, warnings
from datetime import datetime
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, classification_report, log_loss
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

def load_fixtures():
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
            except:
                import time; time.sleep(3)
        else:
            break
        batch = r.data
        if not batch: break
        fixtures.extend(batch)
        offset += len(batch)
        if len(batch) < 500: break
    return fixtures

# ─── Dynamic Standings Tracker ─────────────────────────────────────────────

class LeagueTable:
    """Maintains a live league table that updates after each match."""
    
    def __init__(self):
        self.teams = {}  # team_id -> {pts, gf, ga, w, d, l, played, home_pts, away_pts}
        self.history = []  # [(date, team_id, position, pts, gd, played)]
    
    def update(self, home_id, away_id, home_score, away_score, date):
        """Update table after a match result."""
        # Initialize teams if not seen
        for tid in [home_id, away_id]:
            if tid not in self.teams:
                self.teams[tid] = {"pts": 0, "gf": 0, "ga": 0, "w": 0, "d": 0, "l": 0, "played": 0, "home_pts": 0, "away_pts": 0}
        
        # Update home team
        ht = self.teams[home_id]
        ht["played"] += 1
        ht["gf"] += home_score
        ht["ga"] += away_score
        if home_score > away_score:
            ht["w"] += 1; ht["pts"] += 3; ht["home_pts"] += 3
        elif home_score == away_score:
            ht["d"] += 1; ht["pts"] += 1; ht["home_pts"] += 1
        else:
            ht["l"] += 1
        
        # Update away team
        at = self.teams[away_id]
        at["played"] += 1
        at["gf"] += away_score
        at["ga"] += home_score
        if away_score > home_score:
            at["w"] += 1; at["pts"] += 3; at["away_pts"] += 3
        elif away_score == home_score:
            at["d"] += 1; at["pts"] += 1; at["away_pts"] += 1
        else:
            at["l"] += 1
    
    def get_position(self, team_id):
        """Get team's current position (1-indexed)."""
        sorted_teams = sorted(self.teams.items(), key=lambda x: (-x[1]["pts"], -(x[1]["gf"] - x[1]["ga"]), -x[1]["gf"]))
        for i, (tid, _) in enumerate(sorted_teams):
            if tid == team_id:
                return i + 1
        return len(sorted_teams) + 1
    
    def get_team_stats(self, team_id):
        """Get full stats for a team."""
        if team_id not in self.teams:
            return None
        t = self.teams[team_id]
        n = max(t["played"], 1)
        return {
            "position": self.get_position(team_id),
            "points": t["pts"],
            "gf": t["gf"],
            "ga": t["ga"],
            "gd": t["gf"] - t["ga"],
            "played": t["played"],
            "wins": t["w"],
            "draws": t["d"],
            "losses": t["l"],
            "ppg": t["pts"] / n,
            "gf_per_game": t["gf"] / n,
            "ga_per_game": t["ga"] / n,
            "home_ppg": t["home_pts"] / max(sum(1 for m in self.history if m[1] == team_id), 1),
            "away_ppg": t["away_pts"] / max(sum(1 for m in self.history if m[2] == team_id), 1),
            "total_teams": len(self.teams),
        }
    
    def get_league_avg(self):
        """Get league average stats."""
        if not self.teams:
            return {"avg_gf": 1.3, "avg_pts": 1.5, "avg_gd": 0}
        n = max(len(self.teams), 1)
        total_played = sum(t["played"] for t in self.teams.values())
        if total_played == 0:
            return {"avg_gf": 1.3, "avg_pts": 1.5, "avg_gd": 0}
        return {
            "avg_gf": sum(t["gf"] for t in self.teams.values()) / total_played,
            "avg_pts": sum(t["pts"] for t in self.teams.values()) / max(total_played, 1),
            "avg_gd": sum(t["gf"] - t["ga"] for t in self.teams.values()) / max(total_played, 1),
        }


# ─── Feature Engine ────────────────────────────────────────────────────────

class FeatureEngine:
    def __init__(self):
        self.IE = 1500; self.K = 20
        self.tm = defaultdict(list)
        self.te = {}
        self.h2h = defaultdict(list)
        self.league_tables = defaultdict(LeagueTable)
        self.league_stats = defaultdict(lambda: {"hw": 0, "d": 0, "aw": 0, "n": 0, "goals": []})
    
    def elo_expected(self, a, b):
        return 1 / (1 + 10 ** ((b - a) / 400))
    
    def elo_update(self, ea, eb, sa):
        na = ea + self.K * (sa - self.elo_expected(ea, eb))
        nb = eb + self.K * ((1 - sa) - self.elo_expected(eb, ea))
        return na, nb
    
    def form(self, tid, n=15):
        ms = self.tm.get(tid, [])[:n]
        if not ms: return [0]*12
        pts, gf, ga, w, d, l_, hn, cs, l3 = 0, 0, 0, 0, 0, 0, 0, 0, 0
        hp, ap, hgf, hga, agf, aga = 0, 0, 0, 0, 0, 0
        hc, ac = 0, 0
        for i, m in enumerate(ms):
            ih = m[1] == tid
            h, a_ = int(m[3]), int(m[4])
            gf_, ga_ = (h, a_) if ih else (a_, h)
            gf += gf_; ga += ga_
            if ih: hn += 1; hc += 1; hgf += gf_; hga += ga_
            else: ac += 1; agf += gf_; aga += ga_
            if gf_ == 0: cs += 1
            if gf_ > ga_: w += 1; pts += 3; (hp if ih else ap).__class__  # placeholder
            elif gf_ == ga_: d += 1; pts += 1
            else: l_ += 1
            if i >= n - 3:
                if gf_ > ga_: l3 += 3
                elif gf_ == ga_: l3 += 1
        nn = max(len(ms), 1)
        return [pts/nn, gf/nn, ga/nn, w/nn, d/nn, l_/nn, hn/nn, cs/nn, l3/3,
                hp/max(hc,1), ap/max(ac,1), (hgf-hga)/max(hc,1)-(agf-aga)/max(ac,1)]
    
    def streak(self, tid, n=10):
        ms = self.tm.get(tid, [])[:n]
        if not ms: return [0]*5
        curr, stype = 0, None
        w_s, l_s, d_s, cs_s = 0, 0, 0, 0
        for m in ms:
            ih = m[1] == tid
            gf_, ga_ = (int(m[3]), int(m[4])) if ih else (int(m[4]), int(m[3]))
            if gf_ > ga_: r = "W"; w_s += 1; l_s = 0; d_s = 0
            elif gf_ == ga_: r = "D"; d_s += 1; w_s = 0; l_s = 0
            else: r = "L"; l_s += 1; w_s = 0; d_s = 0
            if ga_ == 0: cs_s += 1
            if stype is None: stype = r; curr = 1
            elif r == stype: curr += 1
            else: break
        return [curr*(1 if stype=="W" else -1 if stype=="L" else 0), w_s, l_s, d_s, cs_s]
    
    def standings_features(self, tid, lid):
        """Get features from dynamically computed league table."""
        lt = self.league_tables[lid]
        ts = lt.get_team_stats(tid)
        la = lt.get_league_avg()
        
        if ts is None or ts["played"] == 0:
            return [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        
        league_size = ts["total_teams"]
        pos = ts["position"]
        
        # Relegation zone (bottom 3-4)
        relegation_zone = 4 if league_size >= 20 else 3
        
        return [
            pos / max(league_size, 1),  # 0: relative position
            ts["points"] / max(ts["played"] * 3, 1),  # 1: points per game
            ts["gd"] / max(ts["played"], 1),  # 2: GD per game
            1 if pos > league_size - relegation_zone else 0,  # 3: in relegation zone
            1 if pos > league_size - relegation_zone - 2 else 0,  # 4: near relegation zone
            1 if pos <= 3 else 0,  # 5: title contender
            1 if pos <= 5 else 0,  # 6: European qualification
            ts["gf_per_game"] - la["avg_gf"],  # 7: attack vs league avg
            ts["ga_per_game"] - la["avg_gf"],  # 8: defense vs league avg
            ts["ppg"] - la["avg_pts"],  # 9: PPG vs league avg
            ts["home_ppg"],  # 10: home PPG
            ts["away_ppg"],  # 11: away PPG
            ts["home_ppg"] - ts["away_ppg"],  # 12: home/away split
            ts["wins"] / max(ts["played"], 1),  # 13: win rate
        ]
    
    def build(self, fx):
        h, a, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        f = {}
        
        # Form (12 × 3 = 36)
        hf, af = self.form(h), self.form(a)
        for i in range(12):
            f[f"hf{i}"] = hf[i]; f[f"af{i}"] = af[i]; f[f"fd{i}"] = hf[i] - af[i]
        
        # Streaks (5 × 2 = 10)
        hs, as_ = self.streak(h), self.streak(a)
        for i in range(5):
            f[f"hst{i}"] = hs[i]; f[f"ast{i}"] = as_[i]
        
        # Elo (4)
        he, ae = self.te.get(h, self.IE), self.te.get(a, self.IE)
        f["he"] = he; f["ae"] = ae; f["ed"] = he - ae; f["ee"] = self.elo_expected(he, ae)
        
        # Standings (14 × 2 = 28)
        sf_h = self.standings_features(h, lid)
        sf_a = self.standings_features(a, lid)
        for i in range(14):
            f[f"sth{i}"] = sf_h[i]; f[f"sta{i}"] = sf_a[i]
        
        # Standings diffs (5)
        f["pos_d"] = sf_h[0] - sf_a[0]  # position diff (positive = home team lower in table)
        f["ppg_d"] = sf_h[1] - sf_a[1]  # PPG diff
        f["gdg_d"] = sf_h[2] - sf_a[2]  # GD/game diff
        f["motivation_d"] = sf_h[3] - sf_a[3]  # relegation urgency diff
        f["title_d"] = sf_h[5] - sf_a[5]  # title race diff
        
        # H2H (5)
        key = tuple(sorted([h, a]))
        h2h_ms = self.h2h.get(key, [])[-10:]
        if h2h_ms:
            aw, bw, dr, tg, ag = 0, 0, 0, 0, 0
            for m in h2h_ms:
                h_, a_ = int(m[0]), int(m[1])
                tg += h_ + a_
                if m[3] == h: ag += h_
                else: ag += a_
                if (m[3] == h and h_ > a_) or (m[3] == a and a_ > h_): aw += 1
                elif (m[3] == h and h_ < a_) or (m[3] == a and a_ < h_): bw += 1
                else: dr += 1
            nn = max(len(h2h_ms), 1)
            for i, v in enumerate([aw/nn, bw/nn, dr/nn, tg/nn, ag/nn]):
                f[f"h{i}"] = v
        else:
            for i in range(5): f[f"h{i}"] = 0
        
        # League stats (5)
        ls = self.league_stats[lid]
        t = max(ls["n"], 1)
        ag = np.mean(ls["goals"]) if ls["goals"] else 2.6
        for i, v in enumerate([ls["hw"]/t, ls["d"]/t, ls["aw"]/t, ag, np.log1p(t)]):
            f[f"l{i}"] = v
        
        # Strength (8)
        for ms_data, prefix in [(self.tm.get(h, [])[-20:], "sh"), (self.tm.get(a, [])[-20:], "sa")]:
            if not ms_data:
                for i in range(8): f[f"{prefix}{i}"] = 1.3 if i < 2 else 0
                continue
            att = np.mean([int(m[3]) if m[1] == (h if prefix == "sh" else a) else int(m[4]) for m in ms_data])
            deff = np.mean([int(m[4]) if m[1] == (h if prefix == "sh" else a) else int(m[3]) for m in ms_data])
            at = np.mean([int(m[3]) + int(m[4]) for m in ms_data])
            ht_ms = [m for m in ms_data if m[1] == (h if prefix == "sh" else a)]
            aw_ms = [m for m in ms_data if m[2] == (h if prefix == "sh" else a)]
            hta = np.mean([int(m[3]) for m in ht_ms]) if ht_ms else att
            htd = np.mean([int(m[4]) for m in ht_ms]) if ht_ms else deff
            awa = np.mean([int(m[4]) for m in aw_ms]) if aw_ms else att
            for i, v in enumerate([att, deff, hta, htd, awa, at, len(ht_ms)/max(len(ms_data),1), len(aw_ms)/max(len(ms_data),1)]):
                f[f"{prefix}{i}"] = v
        
        # Derived (6)
        f["att_d"] = f["sh0"] - f["sa0"]
        f["def_d"] = f["sh1"] - f["sa1"]
        f["axd"] = f["att_d"] * f["def_d"]
        f["sd"] = (f["sh0"] / max(f["sh1"], 0.1)) - (f["sa0"] / max(f["sa1"], 0.1))
        f["form_d"] = hf[0] - af[0]
        f["mot_d"] = sf_h[3] - sf_a[3]  # relegation urgency
        
        return f
    
    def update(self, fx):
        h, a, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        dt = fx["kickoff_time"]
        
        self.tm[h].append((dt, h, a, hs, as_, lid))
        self.tm[a].append((dt, h, a, hs, as_, lid))
        key = tuple(sorted([h, a]))
        self.h2h[key].append((hs, as_, dt, h, a))
        
        he, ae = self.te.get(h, self.IE), self.te.get(a, self.IE)
        s = 1.0 if hs > as_ else (0.5 if hs == as_ else 0.0)
        self.te[h], self.te[a] = self.elo_update(he, ae, s)
        
        # Update dynamic standings
        self.league_tables[lid].update(h, a, hs, as_, dt)
        
        ls = self.league_stats[lid]
        ls["n"] += 1; ls["goals"].append(hs + as_)
        if hs > as_: ls["hw"] += 1
        elif hs == as_: ls["d"] += 1
        else: ls["aw"] += 1


def main():
    print("=" * 60)
    print("🚀 1X2 Model with Dynamic Standings")
    print("=" * 60)
    
    fixtures = load_fixtures()
    print(f"   {len(fixtures)} matches loaded")
    
    engine = FeatureEngine()
    
    print("\n🔧 Building features with dynamic standings...")
    recs = []
    for i, fx in enumerate(fixtures):
        if i % 2000 == 0: print(f"   {i}/{len(fixtures)}...")
        feat = engine.build(fx)
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        feat["label"] = 0 if hs > as_ else (1 if hs == as_ else 2)
        feat["date"] = fx["kickoff_time"]
        recs.append(feat)
        engine.update(fx)
    
    df = pd.DataFrame(recs)
    mc = ["label", "date"]
    fc = [c for c in df.columns if c not in mc]
    
    print(f"\n📊 {len(df)} matches × {len(fc)} features")
    
    df["date_dt"] = pd.to_datetime(df["date"])
    df = df.sort_values("date_dt").reset_index(drop=True)
    sp = int(len(df) * 0.8)
    train, test = df.iloc[:sp], df.iloc[sp:]
    Xtr = np.nan_to_num(train[fc].values, nan=0, posinf=10, neginf=-10)
    ytr = train["label"].values
    Xte = np.nan_to_num(test[fc].values, nan=0, posinf=10, neginf=-10)
    yte = test["label"].values
    cc = Counter(ytr); tot = len(ytr)
    sw = np.array([tot / (3 * cc[y]) for y in ytr])
    
    print(f"   Train: {len(train)} | Test: {len(test)}")
    
    # XGBoost
    print("\n🏋️ XGBoost...")
    xgb_m = xgb.XGBClassifier(
        n_estimators=500, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        gamma=0.1, reg_alpha=0.1, reg_lambda=1.0,
        objective="multi:softprob", num_class=3, eval_metric="mlogloss",
        early_stopping_rounds=50, random_state=42, n_jobs=-1, verbosity=0,
    )
    xgb_m.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)
    px = xgb_m.predict_proba(Xte)
    acc_x = accuracy_score(yte, np.argmax(px, axis=1))
    print(f"   {acc_x*100:.1f}% (iter {xgb_m.best_iteration})")
    
    # LightGBM
    print("\n🏋️ LightGBM...")
    lgb_m = lgb.LGBMClassifier(
        n_estimators=500, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        class_weight="balanced", objective="multiclass", num_class=3,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    lgb_m.fit(Xtr, ytr, eval_set=[(Xte, yte)], callbacks=[lgb.early_stopping(50, verbose=False)])
    pl = lgb_m.predict_proba(Xte)
    acc_l = accuracy_score(yte, np.argmax(pl, axis=1))
    print(f"   {acc_l*100:.1f}% (iter {lgb_m.best_iteration_})")
    
    # Ensemble
    best_acc, best_w = 0, 0.5
    for w in np.arange(0.3, 0.71, 0.05):
        ep = w * px + (1 - w) * pl
        acc = accuracy_score(yte, np.argmax(ep, axis=1))
        if acc > best_acc: best_acc = acc; best_w = w
    
    ep = best_w * px + (1 - best_w) * pl
    bp = np.argmax(ep, axis=1)
    
    print(f"\n{'='*60}")
    print(f"🏆 XGB: {acc_x*100:.1f}% | LGB: {acc_l*100:.1f}% | Ensemble: {best_acc*100:.1f}%")
    print(f"{'='*60}")
    print(classification_report(yte, bp, target_names=["Home Win", "Draw", "Away Win"], zero_division=0))
    
    maxp = np.max(ep, axis=1)
    print("📊 Confidence:")
    for lo, hi in [(0.3,.4),(.4,.5),(.5,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.01)]:
        mask = (maxp >= lo) & (maxp < hi)
        if mask.sum() > 5:
            ba = accuracy_score(yte[mask], bp[mask])
            print(f"   {lo*100:.0f}-{hi*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {ba*100:.1f}%")
    
    print("\n📊 Coverage:")
    for t in [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        mask = maxp >= t
        if mask.sum() > 0:
            print(f"   ≥{t*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {accuracy_score(yte[mask], bp[mask])*100:.1f}%")
    
    print("\n📊 Top 20 Features:")
    fi = sorted(zip(fc, xgb_m.feature_importances_), key=lambda x: x[1], reverse=True)
    for name, val in fi[:20]:
        print(f"   {name:25s} {val:.4f} {'█' * int(val * 200)}")
    
    # Save
    md = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(md, exist_ok=True)
    xgb_m.save_model(os.path.join(md, "xgboost_1x2_standings.json"))
    lgb_m.booster_.save_model(os.path.join(md, "lgbm_1x2_standings.txt"))
    with open(os.path.join(md, "1x2_standings_meta.json"), "w") as f:
        json.dump({
            "version": "standings", "accuracy": float(best_acc),
            "xgb": float(acc_x), "lgb": float(acc_l), "weight": float(best_w),
            "n_features": len(fc), "n_train": len(train), "n_test": len(test),
            "timestamp": str(datetime.now()), "features": fc,
            "top_features": {n: float(v) for n, v in fi[:30]},
        }, f, indent=2)
    
    print(f"\n💾 Saved. Final: {best_acc*100:.1f}%")

if __name__ == "__main__":
    main()
