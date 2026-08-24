#!/usr/bin/env python3
"""
ODDLY Isotonic Regression Calibration
Applies isotonic regression to calibrate the production ensemble probabilities.
If the model says 70% confidence, it should actually win ~70% of the time.

Usage:
  python scripts/calibrate-isotonic.py           # Full dataset
  python scripts/calibrate-isotonic.py --quick    # Quick mode (5K samples)
"""
import json, os, sys, time
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
from sklearn.calibration import calibration_curve
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent.parent / "models"
RESULTS_DIR = DATA_DIR / "xgboost-results"
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

# Import shared utilities
sys.path.insert(0, str(Path(__file__).parent))
import importlib
_train_mod = importlib.import_module("train-xgboost-v6")
get_sb = _train_mod.get_sb
load_data = _train_mod.load_data
load_aux = _train_mod.load_aux
Tracker = _train_mod.Tracker
find_xg = _train_mod.find_xg

# ─── Feature sets ────────────────────────────────────────────

B = ["elo_diff","home_ppg","away_ppg","ppg_diff","home_gs","home_gc","away_gs","away_gc",
     "home_wr","away_wr","home_cs","away_cs","home_hppg","away_appg","hppg_diff",
     "streak_diff","h2h_home"]
X = ["home_xg","away_xg","home_xga","away_xga","xg_diff","xga_diff","has_xg"]
I = ["home_inj","away_inj","inj_diff"]
O = ["home_odds","draw_odds","away_odds","home_implied","draw_implied","away_implied","has_odds"]
M = ["true_home","true_draw","true_away","overround","market_confidence","bookmaker_count"]
ALL_FEATURES = B + X + I + O + M

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

# ─── Calibration Functions ────────────────────────────────────

def fit_isotonic_regressor(y_true, y_pred):
    """Fit isotonic regression on validation set."""
    ir = IsotonicRegression(y_min=0.01, y_max=0.99, out_of_bounds='clip')
    ir.fit(y_pred, y_true)
    return ir

def apply_calibration(ir, y_pred):
    """Apply isotonic calibration to predictions."""
    return ir.predict(y_pred)

def compute_calibration_metrics(y_true, y_pred, y_cal, name="model"):
    """Compute comprehensive calibration metrics."""
    results = {}

    # Raw model metrics
    results["raw"] = {
        "accuracy": float(accuracy_score(y_true, (y_pred >= 0.5).astype(int))),
        "log_loss": float(log_loss(y_true, np.clip(y_pred, 1e-7, 1 - 1e-7))),
        "brier": float(brier_score_loss(y_true, y_pred)),
    }

    # Calibrated model metrics
    results["calibrated"] = {
        "accuracy": float(accuracy_score(y_true, (y_cal >= 0.5).astype(int))),
        "log_loss": float(log_loss(y_true, np.clip(y_cal, 1e-7, 1 - 1e-7))),
        "brier": float(brier_score_loss(y_true, y_cal)),
    }

    # Calibration error (ECE)
    try:
        f_raw, mp_raw = calibration_curve(y_true, y_pred, n_bins=10)
        ece_raw = float(np.mean(np.abs(f_raw - mp_raw)))
    except:
        ece_raw = 1.0

    try:
        f_cal, mp_cal = calibration_curve(y_true, y_cal, n_bins=10)
        ece_cal = float(np.mean(np.abs(f_cal - mp_cal)))
    except:
        ece_cal = 1.0

    results["raw"]["ece"] = ece_raw
    results["calibrated"]["ece"] = ece_cal

    # Tier accuracy
    for threshold, tier_name in [(0.65, "h65"), (0.70, "e70"), (0.80, "e80")]:
        mask_raw = y_pred >= threshold
        mask_cal = y_cal >= threshold

        if mask_raw.sum() > 0:
            results[f"tier_{tier_name}_raw"] = {
                "n": int(mask_raw.sum()),
                "acc": float(accuracy_score(y_true[mask_raw], (y_pred[mask_raw] >= 0.5).astype(int))),
                "cov": float(mask_raw.sum() / len(y_true)),
                "avg_prob": float(np.mean(y_pred[mask_raw])),
            }

        if mask_cal.sum() > 0:
            results[f"tier_{tier_name}_cal"] = {
                "n": int(mask_cal.sum()),
                "acc": float(accuracy_score(y_true[mask_cal], (y_cal[mask_cal] >= 0.5).astype(int))),
                "cov": float(mask_cal.sum() / len(y_true)),
                "avg_prob": float(np.mean(y_cal[mask_cal])),
            }

    return results

# ─── Main ────────────────────────────────────────────────────

def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--quick", action="store_true")
    args = p.parse_args()

    print("=" * 70)
    print("  ODDLY Isotonic Regression Calibration")
    print("=" * 70)

    # Load data
    preds, fixts, teams, leagues, odds = load_data(quick=args.quick)
    xg, inj, mc, clv = load_aux()
    df = build_features(preds, fixts, teams, leagues, odds, xg, inj, mc, clv)

    if len(df) < 100:
        print("Not enough data")
        return

    print(f"\nDataset: {len(df)} rows, {df['label'].mean():.1%} positive")

    # Temporal split
    df_s = df.sort_values("created_at").reset_index(drop=True)
    n = len(df_s)
    train_end = int(n * 0.5)
    val_end = int(n * 0.7)
    test_end = n

    tr = df_s.iloc[:train_end]
    va = df_s.iloc[train_end:val_end]
    te = df_s.iloc[val_end:]

    print(f"Train: {len(tr)} | Val: {len(va)} | Test: {len(te)}")

    # ─── 1. Train Baseline Model (model_probability only) ────

    print("\n" + "=" * 70)
    print("  STEP 1: Train Baseline Model")
    print("=" * 70)

    Xtr = tr[["model_probability"]].values
    ytr = tr["label"].values
    Xva = va[["model_probability"]].values
    yva = va["label"].values
    Xte = te[["model_probability"]].values
    yte = te["label"].values

    # XGBoost on model_probability alone
    model = xgb.XGBClassifier(
        n_estimators=100, learning_rate=0.05, max_depth=3,
        random_state=42, eval_metric="logloss",
        early_stopping_rounds=20, verbose=False
    )
    model.fit(Xtr, ytr, eval_set=[(Xva, yva)])

    p_tr = model.predict_proba(Xtr)[:, 1]
    p_va = model.predict_proba(Xva)[:, 1]
    p_te = model.predict_proba(Xte)[:, 1]

    print(f"\n  Raw Model Performance:")
    print(f"    Train: {accuracy_score(ytr, (p_tr >= 0.5).astype(int)):.1%}")
    print(f"    Val:   {accuracy_score(yva, (p_va >= 0.5).astype(int)):.1%}")
    print(f"    Test:  {accuracy_score(yte, (p_te >= 0.5).astype(int)):.1%}")
    print(f"    Log Loss: {log_loss(yte, np.clip(p_te, 1e-7, 1-1e-7)):.4f}")
    print(f"    Brier:    {brier_score_loss(yte, p_te):.4f}")

    # ─── 2. Fit Isotonic Regression on Validation Set ────────

    print("\n" + "=" * 70)
    print("  STEP 2: Fit Isotonic Regression on Validation Set")
    print("=" * 70)

    ir = fit_isotonic_regressor(yva, p_va)

    # Apply to validation set to verify
    p_va_cal = apply_calibration(ir, p_va)

    print(f"\n  Validation Set Calibration:")
    print(f"    Raw accuracy:      {accuracy_score(yva, (p_va >= 0.5).astype(int)):.1%}")
    print(f"    Calibrated acc:    {accuracy_score(yva, (p_va_cal >= 0.5).astype(int)):.1%}")
    print(f"    Raw Brier:         {brier_score_loss(yva, p_va):.4f}")
    print(f"    Calibrated Brier:  {brier_score_loss(yva, p_va_cal):.4f}")
    print(f"    Raw Log Loss:      {log_loss(yva, np.clip(p_va, 1e-7, 1-1e-7)):.4f}")
    print(f"    Calibrated LL:     {log_loss(yva, np.clip(p_va_cal, 1e-7, 1-1e-7)):.4f}")

    # ─── 3. Apply to Test Set ────────────────────────────────

    print("\n" + "=" * 70)
    print("  STEP 3: Apply Calibration to Test Set")
    print("=" * 70)

    p_te_cal = apply_calibration(ir, p_te)

    metrics = compute_calibration_metrics(yte, p_te, p_te_cal, "Baseline")

    print(f"\n  Test Set Results:")
    print(f"  {'Metric':<25s} {'Raw':>10s} {'Calibrated':>12s} {'Delta':>10s}")
    print(f"  {'-'*57}")

    for metric in ["accuracy", "log_loss", "brier", "ece"]:
        raw = metrics["raw"][metric]
        cal = metrics["calibrated"][metric]
        delta = cal - raw
        delta_str = f"{delta:+.4f}" if metric != "accuracy" else f"{delta:+.1%}"
        print(f"  {metric:<25s} {raw:>10.4f} {cal:>12.4f} {delta_str:>10s}")

    # Tier analysis
    print(f"\n  Tier Analysis:")
    for tier in ["h65", "e70", "e80"]:
        raw_key = f"tier_{tier}_raw"
        cal_key = f"tier_{tier}_cal"
        if raw_key in metrics and cal_key in metrics:
            r = metrics[raw_key]
            c = metrics[cal_key]
            print(f"    {tier}: Raw {r['acc']:.1%} ({r['n']}s, avg={r['avg_prob']:.3f})")
            print(f"         Cal {c['acc']:.1%} ({c['n']}s, avg={c['avg_prob']:.3f})")

    # ─── 4. Compare with XGBoost Full Model ──────────────────

    print("\n" + "=" * 70)
    print("  STEP 4: Compare with XGBoost Full Model")
    print("=" * 70)

    # Train full XGBoost model
    avail = [f for f in ALL_FEATURES if f in tr.columns]
    Xtr_full = tr[avail].fillna(0).values
    Xva_full = va[avail].fillna(0).values
    Xte_full = te[avail].fillna(0).values

    xgb_model = xgb.XGBClassifier(
        n_estimators=500, learning_rate=0.05, max_depth=6,
        min_child_weight=5, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=0.1, random_state=42,
        eval_metric="logloss", early_stopping_rounds=50, verbose=False
    )
    xgb_model.fit(Xtr_full, ytr, eval_set=[(Xva_full, yva)])

    p_xgb = xgb_model.predict_proba(Xte_full)[:, 1]

    # Calibrate XGBoost too
    p_xgb_va = xgb_model.predict_proba(Xva_full)[:, 1]
    ir_xgb = fit_isotonic_regressor(yva, p_xgb_va)
    p_xgb_cal = apply_calibration(ir_xgb, p_xgb)

    xgb_raw_metrics = {
        "accuracy": accuracy_score(yte, (p_xgb >= 0.5).astype(int)),
        "log_loss": log_loss(yte, np.clip(p_xgb, 1e-7, 1-1e-7)),
        "brier": brier_score_loss(yte, p_xgb),
    }
    xgb_cal_metrics = {
        "accuracy": accuracy_score(yte, (p_xgb_cal >= 0.5).astype(int)),
        "log_loss": log_loss(yte, np.clip(p_xgb_cal, 1e-7, 1-1e-7)),
        "brier": brier_score_loss(yte, p_xgb_cal),
    }

    print(f"\n  XGBoost Full Model:")
    print(f"  {'Metric':<25s} {'Raw':>10s} {'Calibrated':>12s}")
    print(f"  {'-'*47}")
    for metric in ["accuracy", "log_loss", "brier"]:
        print(f"  {metric:<25s} {xgb_raw_metrics[metric]:>10.4f} {xgb_cal_metrics[metric]:>12.4f}")

    # ─── 5. Final Comparison ─────────────────────────────────

    print("\n" + "=" * 70)
    print("  FINAL COMPARISON")
    print("=" * 70)

    all_models = [
        ("Baseline (raw)", metrics["raw"]),
        ("Baseline (calibrated)", metrics["calibrated"]),
        ("XGBoost (raw)", xgb_raw_metrics),
        ("XGBoost (calibrated)", xgb_cal_metrics),
    ]

    print(f"\n  {'Model':<30s} {'Acc':>6s} {'LL':>8s} {'Brier':>8s} {'ECE':>8s}")
    print(f"  {'-'*62}")
    for name, m in all_models:
        print(f"  {name:<30s} {m['accuracy']:>5.1%} {m['log_loss']:>8.4f} {m['brier']:>8.4f} {m.get('ece', 0):>8.4f}")

    # ─── 6. Save Calibrator ──────────────────────────────────

    ts = datetime.now().strftime("%Y%m%d-%H%M")

    # Save isotonic regression parameters
    calibrator_data = {
        "trained_at": datetime.now().isoformat(),
        "dataset_size": len(df),
        "train_size": len(tr),
        "val_size": len(va),
        "test_size": len(te),
        "calibrator": {
            "x_thresholds": ir.X_thresholds_.tolist(),
            "y_thresholds": ir.y_thresholds_.tolist(),
        },
        "raw_metrics": metrics["raw"],
        "calibrated_metrics": metrics["calibrated"],
        "improvement": {
            "brier_delta": metrics["calibrated"]["brier"] - metrics["raw"]["brier"],
            "ece_delta": metrics["calibrated"]["ece"] - metrics["raw"]["ece"],
            "log_loss_delta": metrics["calibrated"]["log_loss"] - metrics["raw"]["log_loss"],
        },
    }

    cal_path = MODEL_DIR / "isotonic-calibrator.json"
    cal_path.write_text(json.dumps(calibrator_data, indent=2, default=str))
    print(f"\n  💾 Calibrator saved to {cal_path}")

    # Save results
    results = {
        "timestamp": ts,
        "dataset_size": len(df),
        "baseline_raw": metrics["raw"],
        "baseline_calibrated": metrics["calibrated"],
        "xgb_raw": xgb_raw_metrics,
        "xgb_calibrated": xgb_cal_metrics,
    }
    results_path = RESULTS_DIR / f"isotonic-calibration-{ts}.json"
    results_path.write_text(json.dumps(results, indent=2, default=str))
    print(f"  💾 Results saved to {results_path}")

    # ─── 7. Recommendation ───────────────────────────────────

    print("\n" + "=" * 70)
    print("  RECOMMENDATION")
    print("=" * 70)

    brier_improvement = metrics["raw"]["brier"] - metrics["calibrated"]["brier"]
    ece_improvement = metrics["raw"]["ece"] - metrics["calibrated"]["ece"]

    if brier_improvement > 0.001:
        print(f"  ✅ Isotonic calibration improves Brier score by {brier_improvement:.4f}")
        print(f"     Use calibrated probabilities for value detection and ELITE tier")
    else:
        print(f"  ℹ️  Isotonic calibration has minimal effect (Brier delta: {brier_improvement:.4f})")
        print(f"     The production ensemble is already well-calibrated")

    if ece_improvement > 0.005:
        print(f"  ✅ ECE improved by {ece_improvement:.4f} — predictions are now more reliable")
    else:
        print(f"  ℹ️  ECE improvement minimal ({ece_improvement:.4f}) — model was already calibrated")

    print(f"\n  How to use the calibrator:")
    print(f"    1. Load isotonic-calibrator.json")
    print(f"    2. Apply linear interpolation on X_thresholds → Y_thresholds")
    print(f"    3. Use calibrated probabilities for ELITE selection and value detection")
    print(f"    4. Re-calibrate monthly as new data arrives")
    print()

if __name__ == "__main__":
    main()
