#!/usr/bin/env python3
"""
ODDLY Per-League XGBoost Training
Trains separate models per league and compares against the global model.
Per-league models capture league-specific patterns (e.g., Serie B has more draws).
"""
import json, os, sys, time
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
from sklearn.calibration import calibration_curve
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent.parent / "models"
RESULTS_DIR = DATA_DIR / "xgboost-results"
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

# ─── Import shared utilities from v6 ─────────────────────────

sys.path.insert(0, str(Path(__file__).parent))
from train_xgboost_v6 import get_sb, load_data, load_aux, Tracker, find_xg

# ─── Feature sets ────────────────────────────────────────────

B = ["elo_diff","home_ppg","away_ppg","ppg_diff","home_gs","home_gc","away_gs","away_gc",
     "home_wr","away_wr","home_cs","away_cs","home_hppg","away_appg","hppg_diff",
     "streak_diff","h2h_home"]
X = ["home_xg","away_xg","home_xga","away_xga","xg_diff","xga_diff","has_xg"]
I = ["home_inj","away_inj","inj_diff"]
O = ["home_odds","draw_odds","away_odds","home_implied","draw_implied","away_implied","has_odds"]
M = ["true_home","true_draw","true_away","overround","market_confidence","bookmaker_count"]
ALL_FEATURES = B + X + I + O + M

MIN_SAMPLES_PER_LEAGUE = 50  # Minimum predictions to train a per-league model

# ─── Build features (reuse from v6) ──────────────────────────

def build_features(preds, fixts, teams, leagues, odds, xg, injuries, mc, clv):
    print("Building tracker...")
    t0 = time.time()
    tracker = Tracker()
    for f in sorted([f for f in fixts.values() if f.get("status")=="finished" and f.get("home_score") is not None], key=lambda x: x.get("kickoff_time","")):
        hn = teams.get(f["home_team_id"]); an = teams.get(f["away_team_id"])
        if hn and an: tracker.feed(hn, an, f["home_score"], f["away_score"])
    print(f"  {len(tracker.hist)} teams in {time.time()-t0:.0f}s")

    print("Building features...")
    t0 = time.time()
    rows = []
    for i, p in enumerate(preds):
        fx = fixts.get(p.get("fixture_id"))
        if not fx: continue
        hn = teams.get(fx.get("home_team_id")); an = teams.get(fx.get("away_team_id"))
        if not hn or not an: continue
        ln = leagues.get(fx.get("league_id"), "Unknown")
        hs = tracker.stats(hn); as_ = tracker.stats(an)
        hxg = find_xg(hn, xg); axg = find_xg(an, xg)
        fid = p.get("fixture_id")
        rows.append({
            "label": 1 if p.get("result")=="correct" else 0,
            "model_probability": p.get("model_probability",0),
            "created_at": p.get("created_at",""),
            "fixture_id": fid,
            "league_name": ln,
            "elo_diff": tracker.elo.get(hn,1500) - tracker.elo.get(an,1500),
            "home_ppg": hs["ppg"], "away_ppg": as_["ppg"],
            "ppg_diff": hs["ppg"] - as_["ppg"],
            "home_gs": hs["gs"], "home_gc": hs["gc"],
            "away_gs": as_["gs"], "away_gc": as_["gc"],
            "home_wr": hs["wr"], "away_wr": as_["wr"],
            "home_cs": hs["cs"], "away_cs": as_["cs"],
            "home_hppg": hs["hppg"], "away_appg": as_["appg"],
            "hppg_diff": hs["hppg"] - as_["appg"],
            "streak_diff": hs["streak"] - as_["streak"],
            "h2h_home": tracker.h2h_rate(hn, an) - 0.46,
            "home_xg": (hxg or {}).get("avg_xg", 0) if hxg else 0,
            "away_xg": (axg or {}).get("avg_xg", 0) if axg else 0,
            "home_xga": (hxg or {}).get("avg_xga", 0) if hxg else 0,
            "away_xga": (axg or {}).get("avg_xga", 0) if axg else 0,
            "xg_diff": ((hxg or {}).get("avg_xg",0) if hxg else 0) - ((axg or {}).get("avg_xg",0) if axg else 0),
            "xga_diff": ((hxg or {}).get("avg_xga",0) if hxg else 0) - ((axg or {}).get("avg_xga",0) if axg else 0),
            "has_xg": 1 if hxg and axg else 0,
            "home_inj": len(injuries.get(hn, [])),
            "away_inj": len(injuries.get(an, [])),
            "inj_diff": len(injuries.get(hn, [])) - len(injuries.get(an, [])),
            "home_odds": np.mean(odds.get(fid,{}).get("Home",[0])) if odds.get(fid,{}).get("Home") else 0,
            "draw_odds": np.mean(odds.get(fid,{}).get("Draw",[0])) if odds.get(fid,{}).get("Draw") else 0,
            "away_odds": np.mean(odds.get(fid,{}).get("Away",[0])) if odds.get(fid,{}).get("Away") else 0,
            "home_implied": (1/np.mean(odds.get(fid,{}).get("Home",[99]))) if odds.get(fid,{}).get("Home") else 0,
            "draw_implied": (1/np.mean(odds.get(fid,{}).get("Draw",[99]))) if odds.get(fid,{}).get("Draw") else 0,
            "away_implied": (1/np.mean(odds.get(fid,{}).get("Away",[99]))) if odds.get(fid,{}).get("Away") else 0,
            "has_odds": 1 if odds.get(fid) else 0,
            "true_home": mc.get(fid, {}).get("true_home", 0),
            "true_draw": mc.get(fid, {}).get("true_draw", 0),
            "true_away": mc.get(fid, {}).get("true_away", 0),
            "overround": mc.get(fid, {}).get("overround", 0),
            "market_confidence": mc.get(fid, {}).get("market_confidence", 0),
            "bookmaker_count": mc.get(fid, {}).get("bookmaker_count", 0),
            "clv_home": clv.get(fid, {}).get("clv_home", 0),
            "clv_draw": clv.get(fid, {}).get("clv_draw", 0),
            "clv_away": clv.get(fid, {}).get("clv_away", 0),
            "sharp_money": clv.get(fid, {}).get("sharp_money", 0),
            "closing_implied_home": clv.get(fid, {}).get("closing_implied_home", 0),
            "closing_implied_draw": clv.get(fid, {}).get("closing_implied_draw", 0),
            "closing_implied_away": clv.get(fid, {}).get("closing_implied_away", 0),
        })
        if (i+1) % 5000 == 0: print(f"  {i+1}/{len(preds)}...")
    print(f"  {len(rows)} rows in {time.time()-t0:.0f}s")
    return pd.DataFrame(rows)

# ─── Train a single model ────────────────────────────────────

def train_model(Xtr, ytr, Xva, yva, features, name="model"):
    avail = [f for f in features if f in Xtr.columns]
    if not avail:
        return None, None, []

    Xtr_arr = Xtr[avail].fillna(0).values
    ytr_arr = ytr.values
    Xva_arr = Xva[avail].fillna(0).values
    yva_arr = yva.values

    params = {
        "n_estimators": 500,
        "learning_rate": 0.05,
        "max_depth": 6,
        "min_child_weight": 5,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 0.1,
        "random_state": 42,
        "eval_metric": "logloss",
        "early_stopping_rounds": 50,
        "verbose": False,
    }

    model = xgb.XGBClassifier(**params)
    model.fit(Xtr_arr, ytr_arr, eval_set=[(Xva_arr, yva_arr)])

    # Predictions
    p_tr = model.predict_proba(Xtr_arr)[:, 1]
    p_va = model.predict_proba(Xva_arr)[:, 1]

    # Feature importance
    imp = dict(sorted(zip(avail, model.feature_importances_.tolist()), key=lambda x: -x[1])[:10])

    return model, avail, imp

def evaluate_model(model, avail, Xte, yte, name="model"):
    if model is None or not avail:
        return None

    Xte_arr = Xte[avail].fillna(0).values
    yte_arr = yte.values
    p_te = model.predict_proba(Xte_arr)[:, 1]

    acc = accuracy_score(yte_arr, (p_te >= 0.5).astype(int))
    ll = log_loss(yte_arr, np.clip(p_te, 1e-7, 1 - 1e-7))
    brier = brier_score_loss(yte_arr, p_te)

    try:
        f, mp = calibration_curve(yte_arr, p_te, n_bins=10)
        cal_err = float(np.mean(np.abs(f - mp)))
    except:
        cal_err = 1.0

    # Tier accuracy
    tiers = {}
    for tn, th in [("e70", 0.70), ("h60", 0.60)]:
        mask = p_te >= th
        if mask.sum() > 0:
            tiers[tn] = {
                "n": int(mask.sum()),
                "acc": float(accuracy_score(yte_arr[mask], (p_te[mask] >= 0.5).astype(int))),
                "cov": float(mask.sum() / len(yte_arr)),
            }

    return {
        "name": name,
        "accuracy": acc,
        "log_loss": ll,
        "brier": brier,
        "cal_error": cal_err,
        "tiers": tiers,
        "samples": len(yte_arr),
        "avg_prob": float(np.mean(p_te)),
    }

# ─── Main ────────────────────────────────────────────────────

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--quick", action="store_true")
    args = p.parse_args()

    print("=" * 70)
    print("  ODDLY Per-League XGBoost Training")
    print("=" * 70)

    # Load data
    preds, fixts, teams, leagues, odds = load_data(quick=args.quick)
    xg, inj, mc, clv = load_aux()

    # Build features
    df = build_features(preds, fixts, teams, leagues, odds, xg, inj, mc, clv)

    if len(df) < 100:
        print("Not enough data")
        return

    print(f"\nDataset: {len(df)} rows, {df['label'].mean():.1%} positive")

    # Sort by time for temporal split
    df_s = df.sort_values("created_at").reset_index(drop=True)
    n = len(df_s)
    te = int(n * 0.6)
    ve = int(n * 0.8)

    # ─── 1. Train Global Model ───────────────────────────────

    print("\n" + "=" * 70)
    print("  GLOBAL MODEL")
    print("=" * 70)

    tr_ = df_s.iloc[:te]
    va = df_s.iloc[te:ve]
    te_ = df_s.iloc[ve:]

    print(f"Train: {len(tr_)} | Val: {len(va)} | Test: {len(te_)}")

    g_model, g_feats, g_imp = train_model(tr_[ALL_FEATURES], tr_["label"], va[ALL_FEATURES], va["label"], ALL_FEATURES, "Global")
    g_result = evaluate_model(g_model, g_feats, te_[ALL_FEATURES], te_["label"], "Global")

    if g_result:
        print(f"\n  Global Model:")
        print(f"    Accuracy: {g_result['accuracy']:.1%}")
        print(f"    Log Loss: {g_result['log_loss']:.4f}")
        print(f"    Brier:    {g_result['brier']:.4f}")
        print(f"    Cal Err:  {g_result['cal_error']:.4f}")
        print(f"    Top features: {list(g_imp.keys())[:5]}")
        for tn, td in g_result.get("tiers", {}).items():
            print(f"    {tn}: {td['n']}s {td['acc']:.1%} ({td['cov']:.1%} coverage)")

    # ─── 2. Train Per-League Models ──────────────────────────

    print("\n" + "=" * 70)
    print("  PER-LEAGUE MODELS")
    print("=" * 70)

    leagues_present = df_s["league_name"].unique()
    league_results = {}
    league_models = {}

    for league in sorted(leagues_present):
        league_df = df_s[df_s["league_name"] == league]

        if len(league_df) < MIN_SAMPLES_PER_LEAGUE:
            print(f"\n  {league}: {len(league_df)} samples (need {MIN_SAMPLES_PER_LEAGUE}+, skipped)")
            continue

        print(f"\n  {league}: {len(league_df)} samples")

        # Temporal split within this league
        n_l = len(league_df)
        te_l = int(n_l * 0.6)
        ve_l = int(n_l * 0.8)

        tr_l = league_df.iloc[:te_l]
        va_l = league_df.iloc[te_l:ve_l]
        te_l = league_df.iloc[ve_l:]

        if len(te_l) < 10:
            print(f"    Not enough test samples ({len(te_l)}), using last 20% as test")
            te_l = league_df.iloc[int(n_l * 0.8):]

        l_model, l_feats, l_imp = train_model(tr_l[ALL_FEATURES], tr_l["label"], va_l[ALL_FEATURES], va_l["label"], ALL_FEATURES, league)
        l_result = evaluate_model(l_model, l_feats, te_l[ALL_FEATURES], te_l["label"], league)

        if l_result:
            league_results[league] = l_result
            league_models[league] = {"model": l_model, "features": l_feats}

            delta = l_result["accuracy"] - (g_result["accuracy"] if g_result else 0)
            delta_str = f"+{delta:.1%}" if delta > 0 else f"{delta:.1%}"

            print(f"    Accuracy: {l_result['accuracy']:.1%} ({delta_str} vs global)")
            print(f"    Log Loss: {l_result['log_loss']:.4f} | Brier: {l_result['brier']:.4f}")
            print(f"    Top features: {list(l_imp.keys())[:5]}")
            for tn, td in l_result.get("tiers", {}).items():
                print(f"    {tn}: {td['n']}s {td['acc']:.1%}")
        else:
            print(f"    Failed to train")

    # ─── 3. Hybrid Model (per-league when available) ─────────

    print("\n" + "=" * 70)
    print("  HYBRID MODEL (per-league where available, global otherwise)")
    print("=" * 70)

    hybrid_preds = []
    hybrid_labels = []

    for _, row in te_.iterrows():
        league = row["league_name"]

        # Use per-league model if available and has enough data
        if league in league_models:
            lm = league_models[league]["model"]
            lf = league_models[league]["features"]
            avail = [f for f in lf if f in row.index]
            if avail:
                X_row = row[avail].fillna(0).values.reshape(1, -1)
                pred = lm.predict_proba(X_row)[0, 1]
                hybrid_preds.append(pred)
                hybrid_labels.append(row["label"])
                continue

        # Fallback to global model
        if g_model and g_feats:
            avail = [f for f in g_feats if f in row.index]
            if avail:
                X_row = row[avail].fillna(0).values.reshape(1, -1)
                pred = g_model.predict_proba(X_row)[0, 1]
                hybrid_preds.append(pred)
                hybrid_labels.append(row["label"])

    if hybrid_preds:
        h_preds = np.array(hybrid_preds)
        h_labels = np.array(hybrid_labels)
        h_acc = accuracy_score(h_labels, (h_preds >= 0.5).astype(int))
        h_ll = log_loss(h_labels, np.clip(h_preds, 1e-7, 1 - 1e-7))
        h_brier = brier_score_loss(h_labels, h_preds)

        print(f"\n  Hybrid Model:")
        print(f"    Accuracy: {h_acc:.1%}")
        print(f"    Log Loss: {h_ll:.4f}")
        print(f"    Brier:    {h_brier:.4f}")
        print(f"    Samples:  {len(hybrid_preds)}")

        # Tier analysis
        for tn, th in [("e70", 0.70), ("h60", 0.60)]:
            mask = h_preds >= th
            if mask.sum() > 0:
                tier_acc = accuracy_score(h_labels[mask], (h_preds[mask] >= 0.5).astype(int))
                print(f"    {tn}: {int(mask.sum())}s {tier_acc:.1%} ({mask.sum()/len(h_preds):.1%} coverage)")

    # ─── 4. Summary Comparison ───────────────────────────────

    print("\n" + "=" * 70)
    print("  COMPARISON SUMMARY")
    print("=" * 70)

    all_models = [("Global", g_result)]
    for league, result in sorted(league_results.items()):
        all_models.append((f"League: {league}", result))
    if hybrid_preds:
        all_models.append(("HYBRID", {
            "accuracy": h_acc,
            "log_loss": h_ll,
            "brier": h_brier,
            "samples": len(hybrid_preds),
        }))

    print(f"\n{'Model':<35s} {'Acc':>6s} {'LL':>8s} {'Brier':>8s} {'Samples':>8s}")
    print("-" * 70)
    for name, result in all_models:
        if result:
            print(f"{name:<35s} {result['accuracy']:>5.1%} {result['log_loss']:>8.4f} {result['brier']:>8.4f} {result['samples']:>8d}")

    # ─── 5. Per-League Breakdown from Global Model ───────────

    if g_model and g_feats:
        print(f"\n{'─' * 70}")
        print("Global model accuracy by league (test set):")
        print(f"{'─' * 70}")

        for league in sorted(te_["league_name"].unique()):
            mask = te_["league_name"] == league
            if mask.sum() < 5:
                continue

            X_l = te_.loc[mask, g_feats].fillna(0).values
            y_l = te_.loc[mask, "label"].values
            p_l = g_model.predict_proba(X_l)[:, 1]
            acc_l = accuracy_score(y_l, (p_l >= 0.5).astype(int))
            ll_l = log_loss(y_l, np.clip(p_l, 1e-7, 1 - 1e-7))

            delta = acc_l - (g_result["accuracy"] if g_result else 0)
            delta_str = f"+{delta:.1%}" if delta > 0 else f"{delta:.1%}"

            print(f"  {league:<25s} {acc_l:.1%} ({delta_str}) LL:{ll_l:.4f} n={mask.sum()}")

    # ─── 6. Save Results ─────────────────────────────────────

    ts = datetime.now().strftime("%Y%m%d-%H%M")
    results = {
        "timestamp": ts,
        "dataset_size": len(df),
        "global": g_result,
        "per_league": league_results,
        "hybrid": {
            "accuracy": h_acc if hybrid_preds else 0,
            "log_loss": h_ll if hybrid_preds else 0,
            "brier": h_brier if hybrid_preds else 0,
            "samples": len(hybrid_preds),
        } if hybrid_preds else None,
    }

    out_path = RESULTS_DIR / f"per-league-{ts}.json"
    out_path.write_text(json.dumps(results, indent=2, default=str))
    print(f"\n💾 Results saved to {out_path}")

    # Save per-league models
    for league, ldata in league_models.items():
        safe_name = league.replace(" ", "_").replace("/", "_")
        ldata["model"].save_model(str(MODEL_DIR / f"xgb_{safe_name}.json"))
    if g_model:
        g_model.save_model(str(MODEL_DIR / "xgb_global.json"))
    print(f"💾 Models saved to {MODEL_DIR}")

    # ─── 7. Recommendation ───────────────────────────────────

    print("\n" + "=" * 70)
    print("  RECOMMENDATION")
    print("=" * 70)

    if hybrid_preds and g_result:
        h_better = h_acc > g_result["accuracy"]
        if h_better:
            print(f"  ✅ Hybrid model ({h_acc:.1%}) beats global ({g_result['accuracy']:.1%})")
            print(f"     Use per-league models for: {', '.join(league_models.keys())}")
            print(f"     Use global model as fallback for other leagues")
        else:
            print(f"  ℹ️  Global model ({g_result['accuracy']:.1%}) matches or beats hybrid ({h_acc:.1%})")
            print(f"     Per-league models don't improve over global with current data")
            print(f"     Collect more per-league data to enable specialization")

    best_league = max(league_results.items(), key=lambda x: x[1]["accuracy"], default=None)
    worst_league = min(league_results.items(), key=lambda x: x[1]["accuracy"], default=None)

    if best_league:
        print(f"\n  Strongest league: {best_league[0]} ({best_league[1]['accuracy']:.1%})")
    if worst_league:
        print(f"  Weakest league:   {worst_league[0]} ({worst_league[1]['accuracy']:.1%})")

    print()

if __name__ == "__main__":
    main()
