#!/usr/bin/env python3
"""
ODDLY Feature Ablation Study

Measures the marginal value of each feature group by running walk-forward
validation with incrementally larger feature sets.

Feature groups (in order of addition):
  1. BASELINE:    Elo diff + form (PPG, GF, GA, WR, CS, FTS, streak)
  2. GOALS:       Season-long goals for/against
  3. SHOTS/CARDS: Shots, corners, yellow/red cards, fouls
  4. xG:          Expected goals (xG, xGA, xG diff)
  5. REFEREE:     Referee bias, avg goals, avg cards
  6. INJURIES:    Injured/doubtful counts, injury impact
  7. CONTEXT:     League position, season phase, month

Each step adds one feature group to the previous set.
The delta between steps shows the marginal value of that group.

Usage:
  python worker/feature-ablation.py              # All markets
  python worker/feature-ablation.py --market 1X2 # Specific market
  python worker/feature-ablation.py --quick      # Quick mode (2 folds)
"""

import json, os, sys, time, argparse
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = Path(__file__).parent.parent / "data"
RESULTS_DIR = DATA_DIR / "xgboost-results"
os.makedirs(RESULTS_DIR, exist_ok=True)

# ─── Feature Groups ───────────────────────────────────────────────────

FEATURE_GROUPS = {
    "baseline": {
        "description": "Elo + recent form (PPG, GF, GA, WR, CS, FTS, streak)",
        "features": [
            "elo_diff", "home_ppg_5", "away_ppg_5", "ppg_diff",
            "home_gf_5", "home_ga_5", "away_gf_5", "away_ga_5",
            "home_wr_5", "away_wr_5", "home_cs_5", "away_cs_5",
            "home_fts_5", "away_fts_5", "streak_diff",
        ],
    },
    "goals": {
        "description": "Season-long goals for/against",
        "features": [
            "home_goals_for", "home_goals_against",
            "away_goals_for", "away_goals_against",
        ],
    },
    "shots_cards": {
        "description": "Shots, corners, cards, fouls",
        "features": [
            "home_shots_for", "home_shots_against",
            "away_shots_for", "away_shots_against",
            "home_corners_for", "away_corners_for",
            "home_yellow_cards", "away_yellow_cards",
            "home_red_cards", "away_red_cards",
            "home_fouls_for", "away_fouls_for",
        ],
    },
    "xg": {
        "description": "Expected goals (xG, xGA, xG diff)",
        "features": [
            "home_avg_xg", "home_avg_xga",
            "away_avg_xg", "away_avg_xga",
            "xg_diff", "xga_diff", "has_xg",
        ],
    },
    "referee": {
        "description": "Referee bias and tendencies",
        "features": [
            "ref_home_bias", "ref_avg_goals", "ref_avg_yellow", "has_ref",
        ],
    },
    "injuries": {
        "description": "Injury/suspension impact",
        "features": [
            "home_injured", "home_doubtful", "home_injury_impact",
            "away_injured", "away_doubtful", "away_injury_impact", "injury_diff",
        ],
    },
    "context": {
        "description": "League position, season phase, month",
        "features": [
            "home_position", "away_position", "position_diff",
            "season_phase", "month",
        ],
    },
}

# Build incremental feature sets
ORDER = ["baseline", "goals", "shots_cards", "xg", "referee", "injuries", "context"]

def get_incremental_sets():
    """Return list of (name, description, features) for each incremental set."""
    sets = []
    cumulative = []
    for group_name in ORDER:
        group = FEATURE_GROUPS[group_name]
        cumulative = cumulative + group["features"]
        sets.append((
            group_name,
            group["description"],
            list(cumulative),
        ))
    return sets


# ─── Load Dataset ─────────────────────────────────────────────────────

def load_dataset():
    path = DATA_DIR / "research-dataset.json"
    if not path.exists():
        print("ERROR: research-dataset.json not found.")
        sys.exit(1)
    data = json.loads(path.read_text())
    df = pd.DataFrame(data["data"])
    print(f"Loaded {len(df)} matches, {len(df.columns)} columns")
    return df


# ─── Walk-Forward for One Feature Set ─────────────────────────────────

def run_walk_forward(df, features, target_col, market_name, quick=False):
    """Run walk-forward with a specific feature set. Return aggregated metrics."""
    available = [f for f in features if f in df.columns]

    df_sorted = df.sort_values("date").reset_index(drop=True)
    df_sorted["year"] = pd.to_datetime(df_sorted["date"]).dt.year
    df_sorted["month"] = pd.to_datetime(df_sorted["date"]).dt.month
    df_sorted["season_year"] = df_sorted.apply(
        lambda r: r["season"] if r["season"] else (
            f"{r['year']}{r['year']+1 if r['month'] >= 7 else r['year']}"
        ), axis=1
    )

    seasons = sorted(df_sorted["season_year"].unique())
    min_train = 2
    folds = []

    for i in range(min_train, len(seasons)):
        train_seasons = seasons[:i]
        test_season = seasons[i]

        train_mask = df_sorted["season_year"].isin(train_seasons)
        test_mask = df_sorted["season_year"] == test_season

        train_df = df_sorted[train_mask].copy()
        test_df = df_sorted[test_mask].copy()

        if len(train_df) < 100 or len(test_df) < 10:
            continue

        X_train = train_df[available].fillna(0).values
        y_train = train_df[target_col].values
        X_test = test_df[available].fillna(0).values
        y_test = test_df[target_col].values

        model = xgb.XGBClassifier(
            n_estimators=300, learning_rate=0.05, max_depth=5,
            min_child_weight=5, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=0.1, random_state=42,
            eval_metric="logloss", early_stopping_rounds=30, verbose=False,
        )
        model.fit(X_train, y_train, eval_set=[(X_test, y_test)])

        probs = model.predict_proba(X_test)[:, 1]
        preds = (probs >= 0.5).astype(int)

        acc = accuracy_score(y_test, preds)
        ll = log_loss(y_test, np.clip(probs, 1e-7, 1 - 1e-7))
        brier = brier_score_loss(y_test, probs)

        folds.append({
            "test_season": test_season,
            "train_size": len(train_df),
            "test_size": len(test_df),
            "accuracy": round(acc * 100, 2),
            "log_loss": round(ll, 4),
            "brier": round(brier, 4),
            "features_used": len(available),
            "feature_importance": dict(sorted(
                zip(available, model.feature_importances_),
                key=lambda x: x[1], reverse=True
            )[:5]),
        })

        if quick and i >= min_train + 1:
            break

    if not folds:
        return None

    return {
        "folds": len(folds),
        "total_test": sum(f["test_size"] for f in folds),
        "avg_accuracy": round(np.mean([f["accuracy"] for f in folds]), 2),
        "avg_log_loss": round(np.mean([f["log_loss"] for f in folds]), 4),
        "avg_brier": round(np.mean([f["brier"] for f in folds]), 4),
        "per_fold": folds,
    }


# ─── Main Ablation Study ──────────────────────────────────────────────

def run_ablation(df, market="1X2", quick=False):
    print(f"\n{'='*70}")
    print(f"  FEATURE ABLATION STUDY — Market: {market}")
    print(f"{'='*70}\n")

    # Select target
    target_map = {
        "1X2": "is_home_win",
        "BTTS": "btts",
        "O2.5": "over_2_5",
        "O1.5": "over_1_5",
        "DC_1X": "dc_1x",
    }
    target_col = target_map.get(market, "is_home_win")

    incremental_sets = get_incremental_sets()
    results = []

    # Baseline (no features — majority class)
    print("  Running baseline (majority class)...")
    df_sorted = df.sort_values("date").reset_index(drop=True)
    df_sorted["year"] = pd.to_datetime(df_sorted["date"]).dt.year
    df_sorted["month"] = pd.to_datetime(df_sorted["date"]).dt.month
    df_sorted["season_year"] = df_sorted.apply(
        lambda r: r["season"] if r["season"] else (
            f"{r['year']}{r['year']+1 if r['month'] >= 7 else r['year']}"
        ), axis=1
    )
    seasons = sorted(df_sorted["season_year"].unique())
    baseline_accs = []
    for i in range(2, len(seasons)):
        test_mask = df_sorted["season_year"] == seasons[i]
        test_df = df_sorted[test_mask]
        if len(test_df) < 10:
            continue
        y_test = test_df[target_col].values
        train_mask = df_sorted["season_year"].isin(seasons[:i])
        y_train = df_sorted[train_mask][target_col].values
        majority = 1 if y_train.mean() > 0.5 else 0
        acc = (y_test == majority).mean() * 100
        baseline_accs.append(acc)
        if quick and i >= 3:
            break

    baseline_acc = round(np.mean(baseline_accs), 2) if baseline_accs else 50.0
    baseline_ll = round(-np.mean([
        y * np.log(max(y_train.mean(), 0.01)) + (1-y) * np.log(max(1-y_train.mean(), 0.01))
        for y in y_test
    ]), 4) if baseline_accs else 1.0

    results.append({
        "group": "majority_class",
        "description": "No features — predict most common outcome",
        "n_features": 0,
        "accuracy": baseline_acc,
        "log_loss": baseline_ll,
        "brier": 0.25,
        "delta_accuracy": 0,
        "delta_log_loss": 0,
    })

    prev_acc = baseline_acc
    prev_ll = baseline_ll

    for group_name, description, features in incremental_sets:
        print(f"\n  Running: {group_name} ({len(features)} features)...")
        print(f"    {description}")

        metrics = run_walk_forward(df, features, target_col, market, quick=quick)

        if metrics is None:
            print(f"    SKIPPED (insufficient data)")
            continue

        delta_acc = round(metrics["avg_accuracy"] - prev_acc, 2)
        delta_ll = round(metrics["avg_log_loss"] - prev_ll, 4)

        result = {
            "group": group_name,
            "description": description,
            "n_features": len(features),
            "accuracy": metrics["avg_accuracy"],
            "log_loss": metrics["avg_log_loss"],
            "brier": metrics["avg_brier"],
            "delta_accuracy": delta_acc,
            "delta_log_loss": delta_ll,
            "per_fold": metrics["per_fold"],
            "top_features": metrics["per_fold"][-1]["feature_importance"] if metrics["per_fold"] else {},
        }
        results.append(result)

        sign = "+" if delta_acc >= 0 else ""
        print(f"    -> Accuracy: {metrics['avg_accuracy']:.1f}% (delta {sign}{delta_acc:.1f}%)")
        print(f"    -> LogLoss:  {metrics['avg_log_loss']:.4f} (delta {delta_ll:+.4f})")

        prev_acc = metrics["avg_accuracy"]
        prev_ll = metrics["avg_log_loss"]

    return results


def print_ablation_table(results, market):
    print(f"\n{'='*90}")
    print(f"  FEATURE ABLATION RESULTS — {market}")
    print(f"{'='*90}\n")

    # Header
    print(f"  {'Group':<20} {'#Feat':>5} {'Accuracy':>9} {'dAcc':>7} {'LogLoss':>9} {'dLL':>9} {'Value'}")
    print(f"  {'-'*80}")

    for r in results:
        delta_acc = r["delta_accuracy"]
        delta_ll = r["delta_log_loss"]

        # Value assessment
        if r["n_features"] == 0:
            value = "baseline"
        elif delta_acc > 2.0:
            value = "*** HIGH"
        elif delta_acc > 0.5:
            value = "** MEDIUM"
        elif delta_acc > 0.0:
            value = "* LOW"
        elif delta_acc > -0.5:
            value = "~ NONE"
        else:
            value = "! NEGATIVE"

        sign_acc = "+" if delta_acc >= 0 else ""
        sign_ll = "+" if delta_ll >= 0 else ""

        print(f"  {r['group']:<20} {r['n_features']:>5} {r['accuracy']:>8.1f}% {sign_acc}{delta_acc:>5.1f}% {r['log_loss']:>9.4f} {sign_ll}{delta_ll:>7.4f}  {value}")

    # Final summary
    if len(results) > 1:
        first = results[0]
        last = results[-1]
        total_acc = last["accuracy"] - first["accuracy"]
        total_ll = last["log_loss"] - first["log_loss"]
        print(f"  {'-'*80}")
        print(f"  {'TOTAL':<20} {last['n_features']:>5} {last['accuracy']:>8.1f}% {'+' if total_acc >= 0 else ''}{total_acc:>5.1f}% {last['log_loss']:>9.4f} {total_ll:>+7.4f}")

    # Feature importance from final run
    if results and results[-1].get("top_features"):
        print(f"\n  Top features (final model):")
        for feat, imp in list(results[-1]["top_features"].items())[:5]:
            bar = "#" * int(imp * 50)
            print(f"    {feat:<30} {imp:.4f} {bar}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", default="1X2", choices=["1X2", "BTTS", "O2.5", "O1.5", "DC_1X"])
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--all", action="store_true", help="Run all markets")
    args = parser.parse_args()

    print("=" * 70)
    print("  ODDLY Feature Ablation Study")
    print("  Measures marginal value of each feature group")
    print("=" * 70)

    df = load_dataset()
    t0 = time.time()

    markets = ["1X2", "BTTS", "O2.5"] if args.all else [args.market]

    all_results = {}
    for market in markets:
        results = run_ablation(df, market=market, quick=args.quick)
        all_results[market] = results
        print_ablation_table(results, market)

    elapsed = time.time() - t0
    print(f"\n  Total time: {elapsed:.1f}s")

    # Save results
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    report = {
        "timestamp": ts,
        "markets": markets,
        "quick": args.quick,
        "results": all_results,
        "elapsed_seconds": round(elapsed, 1),
    }
    path = RESULTS_DIR / f"feature-ablation-{ts}.json"
    path.write_text(json.dumps(report, indent=2, default=str))
    print(f"  Results saved: {path}")


if __name__ == "__main__":
    main()
