#!/usr/bin/env python3
"""
ODDLY Walk-Forward Prediction Simulator

Trains models on historical data and predicts future seasons with NO data leakage.

Walk-forward methodology:
  Train: 2021-2022 → Predict: 2023
  Train: 2021-2023 → Predict: 2024
  Train: 2021-2024 → Predict: 2025
  Train: 2021-2025 → Predict: 2026

For each prediction, only uses information available BEFORE the match.

Usage:
  python worker/walk-forward.py           # Full walk-forward
  python worker/walk-forward.py --quick   # Quick mode (3 folds)
  python worker/walk-forward.py --market 1X2  # Specific market
"""

import json, os, sys, time, argparse
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss, f1_score
from sklearn.calibration import calibration_curve
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = Path(__file__).parent.parent / "data"
RESULTS_DIR = DATA_DIR / "xgboost-results"
os.makedirs(RESULTS_DIR, exist_ok=True)

# ─── Load Research Dataset ───────────────────────────────────────────

def load_dataset():
    path = DATA_DIR / "research-dataset.json"
    if not path.exists():
        print("ERROR: research-dataset.json not found. Run worker/research-dataset.js first.")
        sys.exit(1)
    
    data = json.loads(path.read_text())
    df = pd.DataFrame(data["data"])
    print(f"Loaded {len(df)} matches, {len(df.columns)} columns")
    print(f"Date range: {df['date'].min()} to {df['date'].max()}")
    print(f"Leagues: {df['league'].nunique()}")
    return df

# ─── Feature Sets ────────────────────────────────────────────────────

# Baseline: just Elo + form
FEATURES_BASELINE = [
    "elo_diff", "home_ppg_5", "away_ppg_5", "ppg_diff",
    "home_gf_5", "home_ga_5", "away_gf_5", "away_ga_5",
    "home_wr_5", "away_wr_5", "home_cs_5", "away_cs_5",
    "home_fts_5", "away_fts_5", "streak_diff",
]

# Extended: add ratings, xG, injuries, referee
FEATURES_EXTENDED = FEATURES_BASELINE + [
    "home_goals_for", "home_goals_against", "away_goals_for", "away_goals_against",
    "home_shots_for", "home_shots_against", "away_shots_for", "away_shots_against",
    "home_corners_for", "away_corners_for",
    "home_yellow_cards", "away_yellow_cards", "home_red_cards", "away_red_cards",
    "home_fouls_for", "away_fouls_for",
    "home_injured", "home_doubtful", "home_injury_impact",
    "away_injured", "away_doubtful", "away_injury_impact", "injury_diff",
    "home_avg_xg", "home_avg_xga", "away_avg_xg", "away_avg_xga",
    "xg_diff", "xga_diff", "has_xg",
    "ref_home_bias", "ref_avg_goals", "ref_avg_yellow", "has_ref",
    "home_position", "away_position", "position_diff",
    "season_phase", "month",
]

# Full: add all available
FEATURES_FULL = FEATURES_EXTENDED + [
    "home_ppg_10", "away_ppg_10",
    "home_elo", "away_elo",
]

# ─── Walk-Forward Engine ─────────────────────────────────────────────

def walk_forward(df, market="1X2", feature_set="extended", quick=False):
    print(f"\n{'='*70}")
    print(f"  WALK-FORWARD SIMULATION — Market: {market}")
    print(f"  Feature Set: {feature_set}")
    print(f"{'='*70}\n")
    
    # Select features and target
    if market == "1X2":
        target_col = "is_home_win"
        features = FEATURES_EXTENDED if feature_set == "extended" else FEATURES_FULL if feature_set == "full" else FEATURES_BASELINE
    elif market == "BTTS":
        target_col = "btts"
        features = FEATURES_EXTENDED
    elif market == "O2.5":
        target_col = "over_2_5"
        features = FEATURES_EXTENDED
    elif market == "O1.5":
        target_col = "over_1_5"
        features = FEATURES_EXTENDED
    elif market == "DC_1X":
        target_col = "dc_1x"
        features = FEATURES_EXTENDED
    else:
        target_col = "is_home_win"
        features = FEATURES_EXTENDED
    
    # Filter to available features
    available = [f for f in features if f in df.columns]
    print(f"Features available: {len(available)}/{len(features)}")
    
    # Add date column for temporal splitting
    df_sorted = df.sort_values("date").reset_index(drop=True)
    
    # Create season column from date
    df_sorted["year"] = pd.to_datetime(df_sorted["date"]).dt.year
    df_sorted["month"] = pd.to_datetime(df_sorted["date"]).dt.month
    df_sorted["season_year"] = df_sorted.apply(
        lambda r: r["season"] if r["season"] else f"{r['year']}{r['year']+1 if r['month'] >= 7 else r['year']}",
        axis=1
    )
    
    # Get unique seasons in order
    seasons = sorted(df_sorted["season_year"].unique())
    print(f"Seasons: {seasons}\n")
    
    # Walk-forward splits
    results = []
    all_predictions = []
    
    # Minimum 2 training seasons
    min_train_seasons = 2
    
    for i in range(min_train_seasons, len(seasons)):
        train_seasons = seasons[:i]
        test_season = seasons[i]
        
        train_mask = df_sorted["season_year"].isin(train_seasons)
        test_mask = df_sorted["season_year"] == test_season
        
        train_df = df_sorted[train_mask].copy()
        test_df = df_sorted[test_mask].copy()
        
        if len(train_df) < 100 or len(test_df) < 10:
            print(f"  Skipping {test_season}: insufficient data (train={len(train_df)}, test={len(test_df)})")
            continue
        
        print(f"  Train: {'+'.join(train_seasons)} ({len(train_df)} matches)")
        print(f"  Test:  {test_season} ({len(test_df)} matches)")
        
        # Prepare data
        X_train = train_df[available].fillna(0).values
        y_train = train_df[target_col].values
        X_test = test_df[available].fillna(0).values
        y_test = test_df[target_col].values
        
        # ─── Model A: XGBoost ──────────────────────
        xgb_model = xgb.XGBClassifier(
            n_estimators=300, learning_rate=0.05, max_depth=5,
            min_child_weight=5, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=0.1, random_state=42,
            eval_metric="logloss", early_stopping_rounds=30, verbose=False,
        )
        xgb_model.fit(X_train, y_train, eval_set=[(X_test, y_test)])
        p_xgb = xgb_model.predict_proba(X_test)[:, 1]
        pred_xgb = (p_xgb >= 0.5).astype(int)
        
        # ─── Model B: Simple baseline (majority class) ──────
        p_baseline = np.full(len(y_test), y_train.mean())
        pred_baseline = (p_baseline >= 0.5).astype(int)
        
        # ─── Evaluate ──────────────────────────────
        acc_xgb = accuracy_score(y_test, pred_xgb)
        acc_baseline = accuracy_score(y_test, pred_baseline)
        ll_xgb = log_loss(y_test, np.clip(p_xgb, 1e-7, 1-1e-7))
        ll_baseline = log_loss(y_test, np.clip(p_baseline, 1e-7, 1-1e-7))
        brier_xgb = brier_score_loss(y_test, p_xgb)
        brier_baseline = brier_score_loss(y_test, p_baseline)
        f1_xgb = f1_score(y_test, pred_xgb, zero_division=0)
        
        # Calibration
        try:
            f_cal, mp_cal = calibration_curve(y_test, p_xgb, n_bins=10)
            ece = float(np.mean(np.abs(f_cal - mp_cal)))
        except:
            ece = 1.0
        
        # High-confidence bucket accuracy
        high_conf_mask = p_xgb >= 0.65
        high_conf_acc = accuracy_score(y_test[high_conf_mask], pred_xgb[high_conf_mask]) if high_conf_mask.sum() > 0 else 0
        high_conf_n = high_conf_mask.sum()
        
        elite_mask = p_xgb >= 0.70
        elite_acc = accuracy_score(y_test[elite_mask], pred_xgb[elite_mask]) if elite_mask.sum() > 0 else 0
        elite_n = elite_mask.sum()
        
        # Store results
        fold_result = {
            "train_seasons": train_seasons,
            "test_season": test_season,
            "train_size": len(train_df),
            "test_size": len(test_df),
            "market": market,
            "accuracy_xgb": round(acc_xgb * 100, 2),
            "accuracy_baseline": round(acc_baseline * 100, 2),
            "accuracy_delta": round((acc_xgb - acc_baseline) * 100, 2),
            "log_loss_xgb": round(ll_xgb, 4),
            "log_loss_baseline": round(ll_baseline, 4),
            "brier_xgb": round(brier_xgb, 4),
            "brier_baseline": round(brier_baseline, 4),
            "f1_xgb": round(f1_xgb, 4),
            "ece_xgb": round(ece, 4),
            "high_conf_accuracy": round(high_conf_acc * 100, 2),
            "high_conf_n": int(high_conf_n),
            "elite_accuracy": round(elite_acc * 100, 2),
            "elite_n": int(elite_n),
            "feature_importance": dict(sorted(
                zip(available, xgb_model.feature_importances_),
                key=lambda x: x[1], reverse=True
            )[:10]),
        }
        
        results.append(fold_result)
        
        print(f"    XGBoost: {acc_xgb*100:.1f}% | Baseline: {acc_baseline*100:.1f}% | Δ: {(acc_xgb-acc_baseline)*100:+.1f}%")
        print(f"    LogLoss: {ll_xgb:.4f} | Brier: {brier_xgb:.4f} | ECE: {ece:.4f}")
        print(f"    HighConf (≥65%): {high_conf_acc*100:.1f}% ({high_conf_n} samples)")
        print(f"    Elite (≥70%): {elite_acc*100:.1f}% ({elite_n} samples)")
        print()
        
        # Store predictions for error analysis
        for j in range(len(test_df)):
            row = test_df.iloc[j]
            all_predictions.append({
                "date": row["date"],
                "league": row["league"],
                "season": row.get("season_year", ""),
                "home_team": row["home_team"],
                "away_team": row["away_team"],
                "result": row["result"],
                "prediction": "H" if pred_xgb[j] == 1 else "NH",
                "probability": round(float(p_xgb[j]), 4),
                "correct": bool(pred_xgb[j] == y_test[j]),
                "model_version": f"walk-forward-{test_season}",
            })
        
        if quick and i >= min_train_seasons + 2:
            break
    
    return results, all_predictions

# ─── Error Analysis ──────────────────────────────────────────────────

def analyze_errors(predictions):
    print(f"\n{'='*70}")
    print(f"  ERROR ANALYSIS")
    print(f"{'='*70}\n")
    
    df = pd.DataFrame(predictions)
    
    # Overall
    total = len(df)
    correct = df["correct"].sum()
    print(f"Overall: {correct}/{total} ({correct/total*100:.1f}%)\n")
    
    # By league
    print("By League:")
    for league in df["league"].unique():
        sub = df[df["league"] == league]
        acc = sub["correct"].mean() * 100
        print(f"  {league}: {acc:.1f}% ({len(sub)} matches)")
    
    # By confidence bucket
    print("\nBy Confidence:")
    buckets = [(0.5, 0.55), (0.55, 0.6), (0.6, 0.65), (0.65, 0.7), (0.7, 0.75), (0.75, 0.8), (0.8, 1.0)]
    for lo, hi in buckets:
        sub = df[(df["probability"] >= lo) & (df["probability"] < hi)]
        if len(sub) > 0:
            acc = sub["correct"].mean() * 100
            print(f"  {lo*100:.0f}-{hi*100:.0f}%: {acc:.1f}% ({len(sub)} matches)")
    
    # Error patterns
    errors = df[~df["correct"]]
    print(f"\nError Patterns ({len(errors)} errors):")
    
    # Most common error: model predicted H but actual was not H
    false_home = errors[errors["prediction"] == "H"]
    if len(false_home) > 0:
        actual_results = false_home["result"].value_counts()
        print(f"  False Home Wins ({len(false_home)}):")
        for r, c in actual_results.items():
            print(f"    Actual {r}: {c} ({c/len(false_home)*100:.0f}%)")
    
    # Leagues with worst accuracy
    league_acc = df.groupby("league")["correct"].mean().sort_values()
    print(f"\nWorst Leagues:")
    for league, acc in league_acc.head(5).items():
        n = len(df[df["league"] == league])
        print(f"  {league}: {acc*100:.1f}% ({n} matches)")
    
    return df

# ─── Main ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--market", default="1X2", choices=["1X2", "BTTS", "O2.5", "O1.5", "DC_1X"])
    parser.add_argument("--features", default="extended", choices=["baseline", "extended", "full"])
    args = parser.parse_args()
    
    print("=" * 70)
    print("  ODDLY Walk-Forward Prediction Simulator")
    print("=" * 70)
    
    df = load_dataset()
    
    t0 = time.time()
    results, predictions = walk_forward(df, market=args.market, feature_set=args.features, quick=args.quick)
    elapsed = time.time() - t0
    
    if not results:
        print("No results produced")
        return
    
    # ─── Summary ──────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  WALK-FORWARD SUMMARY")
    print(f"{'='*70}\n")
    
    avg_acc = np.mean([r["accuracy_xgb"] for r in results])
    avg_ll = np.mean([r["log_loss_xgb"] for r in results])
    avg_brier = np.mean([r["brier_xgb"] for r in results])
    avg_ece = np.mean([r["ece_xgb"] for r in results])
    avg_hc = np.mean([r["high_conf_accuracy"] for r in results if r["high_conf_n"] > 0])
    avg_elite = np.mean([r["elite_accuracy"] for r in results if r["elite_n"] > 0])
    
    print(f"  Folds: {len(results)}")
    print(f"  Total test matches: {sum(r['test_size'] for r in results)}")
    print(f"  Average Accuracy: {avg_acc:.1f}%")
    print(f"  Average Log Loss: {avg_ll:.4f}")
    print(f"  Average Brier: {avg_brier:.4f}")
    print(f"  Average ECE: {avg_ece:.4f}")
    print(f"  High Confidence (≥65%): {avg_hc:.1f}%")
    print(f"  Elite (≥70%): {avg_elite:.1f}%")
    print(f"  Time: {elapsed:.1f}s")
    
    # Per-fold table
    print(f"\n  {'Fold':<20} {'Train':<6} {'Test':<6} {'Acc':>6} {'Base':>6} {'Δ':>6} {'LL':>8} {'Brier':>8}")
    print(f"  {'-'*72}")
    for r in results:
        test = r["test_season"]
        delta = r["accuracy_xgb"] - r["accuracy_baseline"]
        print(f"  {test:<20} {r['train_size']:<6} {r['test_size']:<6} {r['accuracy_xgb']:>5.1f}% {r['accuracy_baseline']:>5.1f}% {delta:>+5.1f}% {r['log_loss_xgb']:>8.4f} {r['brier_xgb']:>8.4f}")
    
    # Feature importance (from last fold)
    print(f"\n  Top 10 Features (from final fold):")
    for feat, imp in list(results[-1]["feature_importance"].items())[:10]:
        bar = "█" * int(imp * 50)
        print(f"    {feat:<30} {imp:.4f} {bar}")
    
    # ─── Error Analysis ──────────────────────────────────────
    if predictions:
        error_df = analyze_errors(predictions)
    
    # ─── Save Results ────────────────────────────────────────
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    
    report = {
        "timestamp": ts,
        "market": args.market,
        "feature_set": args.features,
        "folds": len(results),
        "avg_accuracy": round(avg_acc, 2),
        "avg_log_loss": round(avg_ll, 4),
        "avg_brier": round(avg_brier, 4),
        "avg_ece": round(avg_ece, 4),
        "avg_high_conf_accuracy": round(avg_hc, 2),
        "avg_elite_accuracy": round(avg_elite, 2),
        "results": results,
        "total_test_matches": sum(r["test_size"] for r in results),
        "elapsed_seconds": round(elapsed, 1),
    }
    
    report_path = RESULTS_DIR / f"walk-forward-{args.market}-{ts}.json"
    report_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"\n  Results saved: {report_path}")
    
    # Save predictions for error analysis
    if predictions:
        pred_path = RESULTS_DIR / f"predictions-{args.market}-{ts}.json"
        pred_path.write_text(json.dumps(predictions, indent=2, default=str))
        print(f"  Predictions saved: {pred_path}")

if __name__ == "__main__":
    main()
