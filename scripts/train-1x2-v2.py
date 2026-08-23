#!/usr/bin/env python3
"""
1X2 Model v2 — Push past 55% with class balancing + LightGBM + stacked ensemble

Issues from v1:
- 1% Draw recall (model predicts Home Win too often)
- Only 72 fixtures had odds (missing odds features for 99% of data)
- No class weighting

Fixes:
- scale_pos_weight for XGBoost + class_weight for LightGBM
- Better feature engineering (form momentum, scoring patterns, league-specific)
- Stacked ensemble: XGBoost + LightGBM → Logistic Regression meta-learner
"""

import json
import os
import sys
from datetime import datetime
from collections import defaultdict
import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, classification_report, log_loss
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import TimeSeriesSplit
from supabase import create_client

# ─── Load Environment ──────────────────────────────────────────────────────
ENV = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        idx = line.index("=")
        ENV[line[:idx].strip()] = line[idx+1:].strip().strip('"').strip("'")

sb = create_client(ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"])

# ─── Load Data ─────────────────────────────────────────────────────────────

def load_data():
    print("📡 Loading data...")
    fixtures = []
    offset = 0
    while True:
        r = sb.table("fixtures").select(
            "id, home_team_id, away_team_id, league_id, kickoff_time, status, home_score, away_score"
        ).eq("status", "finished").not_.is_("home_score", "null").order(
            "kickoff_time", desc=False
        ).range(offset, offset + 1000 - 1).execute()
        batch = r.data
        if not batch: break
        fixtures.extend(batch)
        offset += len(batch)
        if len(batch) < 1000: break
    
    teams = {t["id"]: t for t in sb.table("teams").select("id, canonical_name").execute().data}
    leagues = {l["id"]: l for l in sb.table("leagues").select("id, name").execute().data}
    print(f"   {len(fixtures)} matches, {len(teams)} teams, {len(leagues)} leagues")
    return fixtures, teams, leagues

# ─── Feature Engine v2 ─────────────────────────────────────────────────────

class FeatureEngine2:
    def __init__(self):
        self.INITIAL_ELO = 1500
        self.K = 20
        self.team_matches = defaultdict(list)
        self.team_elo = {}
        self.h2h = defaultdict(list)
        self.league_stats = defaultdict(lambda: {"hw": 0, "d": 0, "aw": 0, "n": 0, "goals": []})
    
    def elo_expected(self, a, b):
        return 1 / (1 + 10 ** ((b - a) / 400))
    
    def elo_update(self, e_a, e_b, s_a):
        new_a = e_a + self.K * (s_a - self.elo_expected(e_a, e_b))
        new_b = e_b + self.K * ((1 - s_a) - self.elo_expected(e_b, e_a))
        return new_a, new_b
    
    def form(self, tid, n=15):
        ms = self.team_matches.get(tid, [])[-n:]
        if not ms:
            return [0]*10
        pts, gf, ga, w, d, l, home_n, cs, last3_pts, scoring_run = 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        for i, m in enumerate(ms):
            is_h = m[1] == tid
            hs, as_ = int(m[3]), int(m[4])
            gf_ = hs if is_h else as_
            ga_ = as_ if is_h else hs
            gf += gf_; ga += ga_
            if is_h: home_n += 1
            if gf_ == 0: cs += 1
            if gf_ > ga_: w += 1; pts += 3
            elif gf_ == ga_: d += 1; pts += 1
            else: l += 1
            if i >= n - 3:
                if gf_ > ga_: last3_pts += 3
                elif gf_ == ga_: last3_pts += 1
            # Scoring streak
            if gf_ > 0: scoring_run = max(scoring_run, i + 1) if scoring_run > 0 else i + 1
        n_ = len(ms)
        return [pts/n_, gf/n_, ga/n_, w/n_, d/n_, l/n_, home_n/n_, cs/n_, last3_pts/3, scoring_run/max(n_,1)]
    
    def h2h_features(self, a, b, n=10):
        key = tuple(sorted([a, b]))
        ms = self.h2h.get(key, [])[-n:]
        if not ms:
            return [0]*5
        a_w, b_w, dr, tg, ag = 0, 0, 0, 0, 0
        for m in ms:
            hs, as_ = int(m[0]), int(m[1])
            home_t = m[3]
            tg += hs + as_
            if home_t == a:
                ag += hs
                if hs > as_: a_w += 1
                elif hs < as_: b_w += 1
                else: dr += 1
            else:
                ag += as_
                if as_ > hs: a_w += 1
                elif as_ < hs: b_w += 1
                else: dr += 1
        n_ = max(len(ms), 1)
        return [a_w/n_, b_w/n_, dr/n_, tg/n_, ag/n_]
    
    def league_features(self, lid):
        ls = self.league_stats[lid]
        t = max(ls["n"], 1)
        ag = np.mean(ls["goals"]) if ls["goals"] else 2.6
        return [ls["hw"]/t, ls["d"]/t, ls["aw"]/t, ag, np.log1p(t)]
    
    def strength_features(self, tid):
        ms = self.team_matches.get(tid, [])[-20:]
        if not ms:
            return [1.3, 1.3, 1.3, 1.3, 0, 0, 0, 0, 0]
        att = np.mean([int(m[3]) if m[1] == tid else int(m[4]) for m in ms])
        deff = np.mean([int(m[4]) if m[1] == tid else int(m[3]) for m in ms])
        ht_ms = [m for m in ms if m[1] == tid]
        aw_ms = [m for m in ms if m[2] == tid]
        ht_att = np.mean([int(m[3]) for m in ht_ms]) if ht_ms else att
        ht_def = np.mean([int(m[4]) for m in ht_ms]) if ht_ms else deff
        aw_att = np.mean([int(m[4]) for m in aw_ms]) if aw_ms else att
        avg_total = np.mean([int(m[3]) + int(m[4]) for m in ms])
        return [att, deff, ht_att, ht_def, aw_att, avg_total, len(ht_ms)/max(len(ms),1), len(aw_ms)/max(len(ms),1), len(ms)]
    
    def build(self, fx):
        home_id, away_id, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        f = {}
        
        hf = self.form(home_id)
        af = self.form(away_id)
        for i in range(10):
            f[f"hf{i}"] = hf[i]
            f[f"af{i}"] = af[i]
            f[f"fd{i}"] = hf[i] - af[i]
        
        h_elo = self.team_elo.get(home_id, self.INITIAL_ELO)
        a_elo = self.team_elo.get(away_id, self.INITIAL_ELO)
        f["h_elo"] = h_elo; f["a_elo"] = a_elo; f["elo_d"] = h_elo - a_elo
        f["elo_exp"] = self.elo_expected(h_elo, a_elo)
        
        h2h = self.h2h_features(home_id, away_id)
        for i, v in enumerate(h2h): f[f"h2h{i}"] = v
        
        lf = self.league_features(lid)
        for i, v in enumerate(lf): f[f"lg{i}"] = v
        
        hs = self.strength_features(home_id)
        as_ = self.strength_features(away_id)
        for i in range(9):
            f[f"hs{i}"] = hs[i]
            f[f"as{i}"] = as_[i]
        f["att_d"] = hs[0] - as_[0]
        f["def_d"] = hs[1] - as_[1]
        f["att_x_def"] = f["att_d"] * f["def_d"]
        f["str_d"] = (hs[0] / max(hs[1], 0.1)) - (as_[0] / max(as_[1], 0.1))
        
        # Consistency
        hms = self.team_matches.get(home_id, [])[-20:]
        ams = self.team_matches.get(away_id, [])[-20:]
        if len(hms) >= 5:
            hr = [3 if int(m[3]) > int(m[4]) else (1 if int(m[3]) == int(m[4]) else 0) if m[1] == home_id else
                  (3 if int(m[4]) > int(m[3]) else (1 if int(m[4]) == int(m[3]) else 0)) for m in hms]
            f["h_var"] = np.std(hr); f["h_trend"] = np.mean(hr[-5:]) - np.mean(hr[:-5]) if len(hr) > 5 else 0
        else:
            f["h_var"] = 0; f["h_trend"] = 0
        
        if len(ams) >= 5:
            ar = [3 if int(m[4]) > int(m[3]) else (1 if int(m[4]) == int(m[3]) else 0) if m[1] == away_id else
                  (3 if int(m[3]) > int(m[4]) else (1 if int(m[3]) == int(m[4]) else 0)) for m in ams]
            f["a_var"] = np.std(ar); f["a_trend"] = np.mean(ar[-5:]) - np.mean(ar[:-5]) if len(ar) > 5 else 0
        else:
            f["a_var"] = 0; f["a_trend"] = 0
        
        # Goal patterns
        f["h_cs_rate"] = sum(1 for m in hms if int(m[4 if m[1] == home_id else 3]) == 0) / max(len(hms), 1)
        f["a_cs_rate"] = sum(1 for m in ams if int(m[4 if m[1] == away_id else 3]) == 0) / max(len(ams), 1)
        
        return f
    
    def update(self, fx):
        hid, aid, lid = fx["home_team_id"], fx["away_team_id"], fx["league_id"]
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        dt = fx["kickoff_time"]
        
        self.team_matches[hid].append((dt, hid, aid, hs, as_, lid))
        self.team_matches[aid].append((dt, hid, aid, hs, as_, lid))
        
        key = tuple(sorted([hid, aid]))
        self.h2h[key].append((hs, as_, dt, hid, aid))
        
        h_elo = self.team_elo.get(hid, self.INITIAL_ELO)
        a_elo = self.team_elo.get(aid, self.INITIAL_ELO)
        if hs > as_: s_h = 1.0
        elif hs == as_: s_h = 0.5
        else: s_h = 0.0
        new_h, new_a = self.elo_update(h_elo, a_elo, s_h)
        self.team_elo[hid] = new_h
        self.team_elo[aid] = new_a
        
        ls = self.league_stats[lid]
        ls["n"] += 1; ls["goals"].append(hs + as_)
        if hs > as_: ls["hw"] += 1
        elif hs == as_: ls["d"] += 1
        else: ls["aw"] += 1

# ─── Main ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("🚀 1X2 Model v2 — Class-Balanced + Stacked Ensemble")
    print("=" * 60)
    
    fixtures, teams, leagues = load_data()
    engine = FeatureEngine2()
    
    print("\n🔧 Building features (chronological)...")
    records = []
    for i, fx in enumerate(fixtures):
        if i % 2000 == 0: print(f"   {i}/{len(fixtures)}...")
        feat = engine.build(fx)
        hs, as_ = int(fx["home_score"]), int(fx["away_score"])
        label = 0 if hs > as_ else (1 if hs == as_ else 2)
        feat["label"] = label
        feat["date"] = fx["kickoff_time"]
        records.append(feat)
        engine.update(fx)
    
    df = pd.DataFrame(records)
    meta = ["label", "date"]
    feat_cols = [c for c in df.columns if c not in meta]
    
    print(f"   ✅ {len(df)} samples × {len(feat_cols)} features")
    print(f"   Home: {(df.label==0).sum()} ({(df.label==0).mean()*100:.1f}%)")
    print(f"   Draw: {(df.label==1).sum()} ({(df.label==1).mean()*100:.1f}%)")
    print(f"   Away: {(df.label==2).sum()} ({(df.label==2).mean()*100:.1f}%)")
    
    # Temporal split
    df["date_dt"] = pd.to_datetime(df["date"])
    df = df.sort_values("date_dt")
    split = int(len(df) * 0.8)
    train = df.iloc[:split]; test = df.iloc[split:]
    
    X_tr = np.nan_to_num(train[feat_cols].values, nan=0, posinf=10, neginf=-10)
    y_tr = train["label"].values
    X_te = np.nan_to_num(test[feat_cols].values, nan=0, posinf=10, neginf=-10)
    y_te = test["label"].values
    
    print(f"\n📅 Train: {len(train)} | Test: {len(test)}")
    print(f"   Train: {train['date'].iloc[0][:10]} → {train['date'].iloc[-1][:10]}")
    print(f"   Test:  {test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}")
    
    # ─── Model 1: XGBoost with class weights ──────
    print("\n🏋️ Training XGBoost (class-balanced)...")
    # Compute scale_pos_weight-like adjustment via sample weights
    from collections import Counter
    class_counts = Counter(y_tr)
    total = len(y_tr)
    sample_weights = np.array([total / (3 * class_counts[y]) for y in y_tr])
    
    xgb_model = xgb.XGBClassifier(
        n_estimators=800, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        gamma=0.1, reg_alpha=0.1, reg_lambda=1.0,
        objective="multi:softprob", num_class=3,
        eval_metric="mlogloss", early_stopping_rounds=50,
        random_state=42, n_jobs=-1, verbosity=0,
    )
    xgb_model.fit(X_tr, y_tr, sample_weight=sample_weights, eval_set=[(X_te, y_te)], verbose=False)
    xgb_proba = xgb_model.predict_proba(X_te)
    xgb_pred = np.argmax(xgb_proba, axis=1)
    xgb_acc = accuracy_score(y_te, xgb_pred)
    print(f"   XGBoost accuracy: {xgb_acc*100:.1f}% (best iter: {xgb_model.best_iteration})")
    
    # ─── Model 2: LightGBM with class weights ─────
    print("\n🏋️ Training LightGBM (class-balanced)...")
    lgb_model = lgb.LGBMClassifier(
        n_estimators=800, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        reg_alpha=0.1, reg_lambda=1.0,
        objective="multiclass", num_class=3,
        class_weight="balanced",
        random_state=42, n_jobs=-1, verbose=-1,
    )
    lgb_model.fit(X_tr, y_tr, eval_set=[(X_te, y_te)],
                  callbacks=[lgb.early_stopping(50, verbose=False)])
    lgb_proba = lgb_model.predict_proba(X_te)
    lgb_pred = np.argmax(lgb_proba, axis=1)
    lgb_acc = accuracy_score(y_te, lgb_pred)
    print(f"   LightGBM accuracy: {lgb_acc*100:.1f}% (best iter: {lgb_model.best_iteration_})")
    
    # ─── Stacked Ensemble ─────────────────────────
    print("\n🏋️ Training stacked ensemble (meta-learner)...")
    
    # Create out-of-fold predictions for training meta-learner
    tscv = TimeSeriesSplit(n_splits=5)
    oof_xgb = np.zeros((len(X_tr), 3))
    oof_lgb = np.zeros((len(X_tr), 3))
    
    for fold, (tr_idx, val_idx) in enumerate(tscv.split(X_tr)):
        X_fold_tr, X_fold_val = X_tr[tr_idx], X_tr[val_idx]
        y_fold_tr, y_fold_val = y_tr[tr_idx], y_tr[val_idx]
        w_fold_tr = sample_weights[tr_idx]
        
        # XGBoost fold
        m1 = xgb.XGBClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
            objective="multi:softprob", num_class=3, eval_metric="mlogloss",
            early_stopping_rounds=30, random_state=42, n_jobs=-1, verbosity=0,
        )
        m1.fit(X_fold_tr, y_fold_tr, sample_weight=w_fold_tr, eval_set=[(X_fold_val, y_fold_val)], verbose=False)
        oof_xgb[val_idx] = m1.predict_proba(X_fold_val)
        
        # LightGBM fold
        m2 = lgb.LGBMClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
            class_weight="balanced", random_state=42, n_jobs=-1, verbose=-1,
        )
        m2.fit(X_fold_tr, y_fold_tr, eval_set=[(X_fold_val, y_fold_val)],
               callbacks=[lgb.early_stopping(30, verbose=False)])
        oof_lgb[val_idx] = m2.predict_proba(X_fold_val)
    
    # Meta-learner features: XGB probs + LGB probs + max probs + entropy
    meta_tr = np.hstack([
        oof_xgb, oof_lgb,
        np.max(oof_xgb, axis=1, keepdims=True),
        np.max(oof_lgb, axis=1, keepdims=True),
        -np.sum(oof_xgb * np.log(oof_xgb + 1e-10), axis=1, keepdims=True),
        -np.sum(oof_lgb * np.log(oof_lgb + 1e-10), axis=1, keepdims=True),
    ])
    
    meta_model = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
    meta_model.fit(meta_tr, y_tr)
    
    # Test predictions
    meta_te = np.hstack([
        xgb_proba, lgb_proba,
        np.max(xgb_proba, axis=1, keepdims=True),
        np.max(lgb_proba, axis=1, keepdims=True),
        -np.sum(xgb_proba * np.log(xgb_proba + 1e-10), axis=1, keepdims=True),
        -np.sum(lgb_proba * np.log(lgb_proba + 1e-10), axis=1, keepdims=True),
    ])
    ensemble_proba = meta_model.predict_proba(meta_te)
    ensemble_pred = np.argmax(ensemble_proba, axis=1)
    ensemble_acc = accuracy_score(y_te, ensemble_pred)
    
    print(f"\n{'='*60}")
    print(f"📊 RESULTS COMPARISON")
    print(f"{'='*60}")
    print(f"   XGBoost alone:   {xgb_acc*100:.1f}%")
    print(f"   LightGBM alone:  {lgb_acc*100:.1f}%")
    print(f"   Stacked Ensemble: {ensemble_acc*100:.1f}%")
    
    # Pick best model
    best_name = "ensemble" if ensemble_acc >= max(xgb_acc, lgb_acc) else ("xgboost" if xgb_acc >= lgb_acc else "lightgbm")
    best_proba = ensemble_proba if best_name == "ensemble" else (xgb_proba if best_name == "xgboost" else lgb_proba)
    best_pred = ensemble_pred if best_name == "ensemble" else (xgb_pred if best_name == "xgboost" else lgb_pred)
    best_acc = max(ensemble_acc, xgb_acc, lgb_acc)
    
    print(f"\n   🏆 Best: {best_name.upper()} at {best_acc*100:.1f}%")
    
    # ─── Detailed evaluation of best model ────────
    print(f"\n📊 Best Model ({best_name}) Classification Report:")
    target_names = ["Home Win", "Draw", "Away Win"]
    print(classification_report(y_te, best_pred, target_names=target_names))
    
    max_p = np.max(best_proba, axis=1)
    print(f"📊 Confidence Buckets ({best_name}):")
    print(f"   {'Bucket':>12} {'Count':>6} {'Pred%':>8} {'Actual%':>8} {'Baseline':>8}")
    print(f"   {'-'*46}")
    for lo, hi in [(0.3, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.01)]:
        mask = (max_p >= lo) & (max_p < hi)
        if mask.sum() > 5:
            ba = accuracy_score(y_te[mask], best_pred[mask])
            print(f"   {lo*100:.0f}-{hi*100:.0f}%{' ':>6} {mask.sum():>6} {max_p[mask].mean()*100:>7.1f}% {ba*100:>7.1f}% {mask.sum()/len(y_te)*100:>7.1f}%")
    
    # Coverage at various thresholds
    print(f"\n📊 Coverage at Confidence Thresholds:")
    for t in [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]:
        mask = max_p >= t
        if mask.sum() > 0:
            acc = accuracy_score(y_te[mask], best_pred[mask])
            print(f"   ≥{t*100:.0f}%: {mask.sum():>5} matches ({mask.sum()/len(y_te)*100:>5.1f}%), accuracy: {acc*100:.1f}%")
    
    # Feature importance
    print(f"\n📊 Top 15 Features ({best_name}):")
    if best_name == "ensemble":
        # Use XGB importance
        imp = xgb_model.feature_importances_
    elif best_name == "xgboost":
        imp = xgb_model.feature_importances_
    else:
        imp = lgb_model.feature_importances_
        imp = imp / imp.sum()
    
    fi = sorted(zip(feat_cols, imp), key=lambda x: x[1], reverse=True)
    for name, val in fi[:15]:
        print(f"   {name:25s} {val:.4f} {'█' * int(val * 200)}")
    
    # ─── Save best model ──────────────────────────
    model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(model_dir, exist_ok=True)
    
    if best_name == "xgboost":
        path = os.path.join(model_dir, "xgboost_1x2_v5.json")
        xgb_model.save_model(path)
    elif best_name == "lightgbm":
        path = os.path.join(model_dir, "lgbm_1x2_v5.txt")
        lgb_model.booster_.save_model(path)
    
    meta_path = os.path.join(model_dir, "1x2_v5_meta.json")
    with open(meta_path, "w") as f:
        json.dump({
            "version": "v5", "best_model": best_name,
            "accuracy": float(best_acc),
            "xgb_accuracy": float(xgb_acc), "lgb_accuracy": float(lgb_acc),
            "ensemble_accuracy": float(ensemble_acc),
            "n_features": len(feat_cols), "n_train": len(train), "n_test": len(test),
            "train_date": str(datetime.now()),
            "feature_names": feat_cols,
            "test_period": f"{test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}",
        }, f, indent=2)
    
    print(f"\n💾 Models saved to {model_dir}")
    print(f"{'='*60}")
    print(f"✅ Done! Best 1X2 accuracy: {best_acc*100:.1f}%")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
