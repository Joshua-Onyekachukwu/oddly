#!/usr/bin/env python3
"""
1X2 Gradient Boosting Model — Train on 10K+ Finished Matches

Approach:
1. Export all finished fixtures + team data from Supabase
2. Compute features chronologically (no future leakage)
3. Train XGBoost classifier on Home/Draw/Away prediction
4. Evaluate with proper train/test split (by time)
"""

import json
import os
import sys
from datetime import datetime, timedelta
from collections import defaultdict
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report, log_loss
from sklearn.preprocessing import LabelEncoder

# ─── Load Environment ──────────────────────────────────────────────────────
ENV = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        idx = line.index("=")
        key = line[:idx].strip()
        val = line[idx + 1:].strip().strip('"').strip("'")
        ENV[key] = val

# ─── Supabase Client ──────────────────────────────────────────────────────
try:
    from supabase import create_client
    sb = create_client(ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"])
    HAS_SUPABASE = True
except ImportError:
    print("⚠️  supabase-py not installed, using local JSON fallback")
    HAS_SUPABASE = False

# ─── Data Loading ──────────────────────────────────────────────────────────

def load_fixtures_from_supabase():
    """Load all finished fixtures with team and league data."""
    print("📡 Loading fixtures from Supabase...")
    
    # Get all finished fixtures
    fixtures = []
    offset = 0
    batch_size = 1000
    
    while True:
        result = sb.table("fixtures").select(
            "id, external_id, home_team_id, away_team_id, league_id, "
            "kickoff_time, status, home_score, away_score"
        ).eq("status", "finished").not_.is_("home_score", "null").order(
            "kickoff_time", desc=False
        ).range(offset, offset + batch_size - 1).execute()
        
        batch = result.data
        if not batch:
            break
        fixtures.extend(batch)
        offset += batch_size
        if len(batch) < batch_size:
            break
    
    print(f"   Loaded {len(fixtures)} finished fixtures")
    return fixtures


def load_teams():
    """Load all teams."""
    result = sb.table("teams").select("id, canonical_name, country").execute()
    teams = {t["id"]: t for t in result.data}
    print(f"   Loaded {len(teams)} teams")
    return teams


def load_leagues():
    """Load all leagues."""
    result = sb.table("leagues").select("id, name, country").execute()
    leagues = {l["id"]: l for l in result.data}
    print(f"   Loaded {len(leagues)} leagues")
    return leagues


def load_odds():
    """Load odds snapshots for fixtures."""
    print("📡 Loading odds...")
    odds = {}
    offset = 0
    batch_size = 2000
    
    while True:
        result = sb.table("odds_snapshots").select(
            "fixture_id, market, selection, odds"
        ).range(offset, offset + batch_size - 1).execute()
        
        batch = result.data
        if not batch:
            break
        
        for o in batch:
            fid = o["fixture_id"]
            if fid not in odds:
                odds[fid] = {}
            key = f"{o['market']}_{o['selection']}"
            odds[fid][key] = o["odds"]
        
        offset += batch_size
        if len(batch) < batch_size:
            break
    
    print(f"   Loaded odds for {len(odds)} fixtures")
    return odds


# ─── Feature Engineering ───────────────────────────────────────────────────

class FeatureEngine:
    """Compute features chronologically — no future data leakage."""
    
    def __init__(self):
        # Team historical stats (rolling window)
        self.team_matches = defaultdict(list)  # team_id -> [(date, home, away, hs, as, league)]
        self.team_form = {}  # team_id -> recent form vector
        self.team_elo = {}  # team_id -> Elo rating
        self.h2h = {}  # (team1_id, team2_id) -> [(hs, as, date)]
        self.league_stats = defaultdict(lambda: {"home_wins": 0, "draws": 0, "away_wins": 0, "total": 0, "avg_goals": []})
        
        # Initialize Elo
        self.INITIAL_ELO = 1500
        self.K_FACTOR = 20
    
    def expected_score(self, elo_a, elo_b):
        """Expected score from Elo difference."""
        return 1 / (1 + 10 ** ((elo_b - elo_a) / 400))
    
    def update_elo(self, winner_elo, loser_elo, is_draw=False):
        """Update Elo ratings after a match."""
        if is_draw:
            exp_winner = self.expected_score(winner_elo, loser_elo)
            exp_loser = 1 - exp_winner
            new_winner = winner_elo + self.K_FACTOR * (0.5 - exp_winner)
            new_loser = loser_elo + self.K_FACTOR * (0.5 - exp_loser)
        else:
            exp_winner = self.expected_score(winner_elo, loser_elo)
            exp_loser = 1 - exp_winner
            new_winner = winner_elo + self.K_FACTOR * (1 - exp_winner)
            new_loser = loser_elo + self.K_FACTOR * (0 - exp_loser)
        return new_winner, new_loser
    
    def compute_form(self, team_id, n_recent=10):
        """Compute rolling form vector for a team."""
        matches = self.team_matches.get(team_id, [])[-n_recent:]
        if not matches:
            return [0] * 8
        
        points = 0
        goals_for = 0
        goals_against = 0
        wins = 0
        draws = 0
        losses = 0
        home_games = 0
        clean_sheets = 0
        
        for m in matches:
            is_home = m[1] == team_id
            # tuple: (kickoff, home_id, away_id, home_score, away_score, league_id)
            hs, as_ = int(m[3]), int(m[4])
            gf = hs if is_home else as_
            ga = as_ if is_home else hs
            goals_for += gf
            goals_against += ga
            
            if is_home:
                home_games += 1
            
            if gf > 0:
                pass
            else:
                clean_sheets += 1
            
            if gf > ga:
                wins += 1
                points += 3
            elif gf == ga:
                draws += 1
                points += 1
            else:
                losses += 1
        
        n = len(matches)
        return [
            points / n,
            goals_for / n,
            goals_against / n,
            wins / n,
            draws / n,
            losses / n,
            home_games / n,
            clean_sheets / n,
        ]
    
    def compute_h2h(self, team_a, team_b, n_recent=10):
        """Head-to-head features."""
        key1 = (team_a, team_b)
        key2 = (team_b, team_a)
        matches = self.h2h.get(key1, []) + self.h2h.get(key2, [])
        matches.sort(key=lambda x: x[2])
        matches = matches[-n_recent:]
        
        if not matches:
            return [0] * 5
        
        a_wins = 0
        b_wins = 0
        draws_count = 0
        total_goals = 0
        a_goals = 0
        
        for m in matches:
            # m = (hs, as, date, home_team, away_team) 
            hs, as_, date, home_t, away_t = m
            hs = int(hs)
            as_ = int(as_)
            if home_t == team_a:
                a_goals += hs
                if hs > as_:
                    a_wins += 1
                elif hs < as_:
                    b_wins += 1
                else:
                    draws_count += 1
            else:
                a_goals += as_
                if as_ > hs:
                    a_wins += 1
                elif as_ < hs:
                    b_wins += 1
                else:
                    draws_count += 1
            total_goals += hs + as_
        
        n = len(matches)
        return [a_wins / n, b_wins / n, draws_count / n, total_goals / n, a_goals / n]
    
    def compute_league_features(self, league_id):
        """League-wide home advantage and goal stats."""
        ls = self.league_stats.get(league_id, {"home_wins": 0, "draws": 0, "away_wins": 0, "total": 0, "avg_goals": []})
        total = max(ls["total"], 1)
        avg_goals = np.mean(ls["avg_goals"]) if ls["avg_goals"] else 1.3
        
        return [
            ls["home_wins"] / total,  # home win rate
            ls["draws"] / total,      # draw rate
            ls["away_wins"] / total,  # away win rate
            avg_goals,                 # avg total goals
            total,                     # matches observed (log scale)
        ]
    
    def build_features(self, fixture, fixtures_before):
        """Build feature vector for a single fixture using only prior data."""
        home_id = fixture["home_team_id"]
        away_id = fixture["away_team_id"]
        league_id = fixture["league_id"]
        kickoff = fixture["kickoff_time"]
        
        features = {}
        
        # ─── Form features (8 each) ─────────────
        home_form = self.compute_form(home_id)
        away_form = self.compute_form(away_id)
        
        for i, val in enumerate(home_form):
            features[f"home_form_{i}"] = val
        for i, val in enumerate(away_form):
            features[f"away_form_{i}"] = val
        
        # ─── Form difference ─────────────────────
        for i in range(8):
            features[f"form_diff_{i}"] = home_form[i] - away_form[i]
        
        # ─── Elo features ────────────────────────
        home_elo = self.team_elo.get(home_id, self.INITIAL_ELO)
        away_elo = self.team_elo.get(away_id, self.INITIAL_ELO)
        features["home_elo"] = home_elo
        features["away_elo"] = away_elo
        features["elo_diff"] = home_elo - away_elo
        features["elo_expected_home"] = self.expected_score(home_elo, away_elo)
        
        # ─── H2H features (5) ────────────────────
        h2h = self.compute_h2h(home_id, away_id)
        for i, val in enumerate(h2h):
            features[f"h2h_{i}"] = val
        
        # ─── League features (5) ─────────────────
        league_feat = self.compute_league_features(league_id)
        for i, val in enumerate(league_feat):
            features[f"league_{i}"] = val
        
        # ─── Strength features ───────────────────
        home_matches = self.team_matches.get(home_id, [])
        away_matches = self.team_matches.get(away_id, [])
        
        # Home attack/defense ratings
        # tuple: (kickoff, home_id, away_id, home_score, away_score, league_id)
        home_attack = np.mean([int(m[3]) if m[1] == home_id else int(m[4]) for m in home_matches[-20:]]) if home_matches else 1.3
        home_defense = np.mean([int(m[4]) if m[1] == home_id else int(m[3]) for m in home_matches[-20:]]) if home_matches else 1.3
        away_attack = np.mean([int(m[3]) if m[1] == away_id else int(m[4]) for m in away_matches[-20:]]) if away_matches else 1.3
        away_defense = np.mean([int(m[4]) if m[1] == away_id else int(m[3]) for m in away_matches[-20:]]) if away_matches else 1.3
        
        features["home_attack"] = home_attack
        features["home_defense"] = home_defense
        features["away_attack"] = away_attack
        features["away_defense"] = away_defense
        features["attack_diff"] = home_attack - away_attack
        features["defense_diff"] = home_defense - away_defense
        features["attack_x_defense"] = (home_attack - away_attack) * (home_defense - away_defense)
        
        # ─── Goals-based features ────────────────
        home_total_goals = sum(int(m[3]) + int(m[4]) for m in home_matches[-20:]) / max(len(home_matches[-20:]), 1)
        away_total_goals = sum(int(m[3]) + int(m[4]) for m in away_matches[-20:]) / max(len(away_matches[-20:]), 1)
        features["home_avg_total"] = home_total_goals
        features["away_avg_total"] = away_total_goals
        features["combined_goals"] = home_total_goals + away_total_goals
        
        # ─── Consistency features ────────────────
        if len(home_matches) >= 5:
            home_results = []
            for m in home_matches[-20:]:
                gf = int(m[3]) if m[1] == home_id else int(m[4])
                ga = int(m[4]) if m[1] == home_id else int(m[3])
                home_results.append(3 if gf > ga else (1 if gf == ga else 0))
            features["home_consistency"] = np.std(home_results) if len(home_results) > 1 else 0
        else:
            features["home_consistency"] = 0
        
        if len(away_matches) >= 5:
            away_results = []
            for m in away_matches[-20:]:
                gf = int(m[3]) if m[1] == away_id else int(m[4])
                ga = int(m[4]) if m[1] == away_id else int(m[3])
                away_results.append(3 if gf > ga else (1 if gf == ga else 0))
            features["away_consistency"] = np.std(away_results) if len(away_results) > 1 else 0
        else:
            features["away_consistency"] = 0
        
        # ─── Matches played (experience) ─────────
        features["home_matches_played"] = len(home_matches)
        features["away_matches_played"] = len(away_matches)
        
        return features
    
    def update_state(self, fixture):
        """Update internal state with a completed fixture (after feature extraction)."""
        home_id = fixture["home_team_id"]
        away_id = fixture["away_team_id"]
        league_id = fixture["league_id"]
        hs = int(fixture["home_score"] or 0)
        as_ = int(fixture["away_score"] or 0)
        kickoff = fixture["kickoff_time"]
        
        # Update team matches
        self.team_matches[home_id].append((kickoff, home_id, away_id, hs, as_, league_id))
        self.team_matches[away_id].append((kickoff, home_id, away_id, hs, as_, league_id))
        
        # Update H2H
        key = (home_id, away_id)
        if key not in self.h2h:
            self.h2h[key] = []
        self.h2h[key].append((hs, as_, kickoff, home_id, away_id))
        
        # Update Elo
        home_elo = self.team_elo.get(home_id, self.INITIAL_ELO)
        away_elo = self.team_elo.get(away_id, self.INITIAL_ELO)
        
        if hs > as_:
            new_home, new_away = self.update_elo(home_elo, away_elo, is_draw=False)
        elif hs < as_:
            new_away, new_home = self.update_elo(away_elo, home_elo, is_draw=False)
        else:
            new_home, new_away = self.update_elo(home_elo, away_elo, is_draw=True)
        
        self.team_elo[home_id] = new_home
        self.team_elo[away_id] = new_away
        
        # Update league stats
        ls = self.league_stats[league_id]
        ls["total"] += 1
        ls["avg_goals"].append(hs + as_)
        if hs > as_:
            ls["home_wins"] += 1
        elif hs == as_:
            ls["draws"] += 1
        else:
            ls["away_wins"] += 1


# ─── Main Training Pipeline ───────────────────────────────────────────────

def main():
    print("=" * 60)
    print("🚀 1X2 Gradient Boosting Model — Training Pipeline")
    print("=" * 60)
    
    # Load data
    if not HAS_SUPABASE:
        print("❌ Need supabase-py to load data. Install: pip install supabase")
        sys.exit(1)
    
    fixtures = load_fixtures_from_supabase()
    teams = load_teams()
    leagues = load_leagues()
    odds = load_odds()
    
    if len(fixtures) < 100:
        print(f"❌ Only {len(fixtures)} fixtures found. Need at least 100.")
        sys.exit(1)
    
    print(f"\n📊 Dataset: {len(fixtures)} finished matches")
    print(f"   Leagues: {len(set(f['league_id'] for f in fixtures))}")
    print(f"   Date range: {fixtures[0]['kickoff_time'][:10]} → {fixtures[-1]['kickoff_time'][:10]}")
    
    # ─── Feature Extraction ──────────────────────
    print("\n🔧 Extracting features (chronological — no leakage)...")
    
    engine = FeatureEngine()
    records = []
    
    for i, fixture in enumerate(fixtures):
        if i % 1000 == 0:
            print(f"   Processing {i}/{len(fixtures)}...")
        
        # Build features BEFORE updating state (no leakage)
        features = engine.build_features(fixture, fixtures[:i])
        
        # Determine label: Home=0, Draw=1, Away=2
        hs = int(fixture["home_score"] or 0)
        as_ = int(fixture["away_score"] or 0)
        
        if hs > as_:
            label = 0  # Home Win
        elif hs == as_:
            label = 1  # Draw
        else:
            label = 2  # Away Win
        
        # Add odds features if available
        fid = fixture["id"]
        fixture_odds = odds.get(fid, {})
        features["odds_home"] = fixture_odds.get("match_result_Home", 0) or 0
        features["odds_draw"] = fixture_odds.get("match_result_Draw", 0) or 0
        features["odds_away"] = fixture_odds.get("match_result_Away", 0) or 0
        
        # Implied probabilities from odds
        if features["odds_home"] > 0:
            features["implied_home"] = 1 / features["odds_home"]
            features["implied_draw"] = 1 / features["odds_draw"] if features["odds_draw"] > 0 else 0.25
            features["implied_away"] = 1 / features["odds_away"] if features["odds_away"] > 0 else 0.25
            overround = features["implied_home"] + features["implied_draw"] + features["implied_away"]
            features["overround"] = overround
            features["edge_home"] = features.get("elo_expected_home", 0.5) - features["implied_home"]
        else:
            features["implied_home"] = 0
            features["implied_draw"] = 0
            features["implied_away"] = 0
            features["overround"] = 0
            features["edge_home"] = 0
        
        # League name as numeric
        league = leagues.get(fixture["league_id"], {})
        features["league_id_enc"] = hash(league.get("name", "")) % 100
        
        features["label"] = label
        features["fixture_id"] = fid
        features["date"] = fixture["kickoff_time"]
        
        records.append(features)
        
        # Update state AFTER feature extraction
        engine.update_state(fixture)
    
    print(f"   ✅ Extracted {len(records)} records with {len(records[0]) - 3} features each")
    
    # ─── Build DataFrame ─────────────────────────
    df = pd.DataFrame(records)
    
    # Remove non-feature columns
    meta_cols = ["label", "fixture_id", "date"]
    feature_cols = [c for c in df.columns if c not in meta_cols]
    
    print(f"\n📊 Feature matrix: {df.shape[0]} samples × {len(feature_cols)} features")
    print(f"   Label distribution:")
    label_counts = df["label"].value_counts().sort_index()
    for label, count in label_counts.items():
        name = ["Home Win", "Draw", "Away Win"][label]
        print(f"     {name}: {count} ({count/len(df)*100:.1f}%)")
    
    # ─── Train/Test Split (by time) ──────────────
    df["date_dt"] = pd.to_datetime(df["date"])
    df = df.sort_values("date_dt")
    
    # Use last 20% as test set (temporal split — no leakage)
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    
    print(f"\n📅 Temporal split:")
    print(f"   Train: {len(train_df)} matches ({train_df['date'].iloc[0][:10]} → {train_df['date'].iloc[-1][:10]})")
    print(f"   Test:  {len(test_df)} matches ({test_df['date'].iloc[0][:10]} → {test_df['date'].iloc[-1][:10]})")
    
    X_train = train_df[feature_cols].values
    y_train = train_df["label"].values
    X_test = test_df[feature_cols].values
    y_test = test_df["label"].values
    
    # Replace inf/nan
    X_train = np.nan_to_num(X_train, nan=0.0, posinf=10.0, neginf=-10.0)
    X_test = np.nan_to_num(X_test, nan=0.0, posinf=10.0, neginf=-10.0)
    
    # ─── Train XGBoost ───────────────────────────
    print("\n🏋️ Training XGBoost model...")
    
    model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=0.1,
        reg_alpha=0.1,
        reg_lambda=1.0,
        objective="multi:softprob",
        num_class=3,
        eval_metric="mlogloss",
        early_stopping_rounds=50,
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    
    print(f"   Best iteration: {model.best_iteration}")
    
    # ─── Evaluate ────────────────────────────────
    print("\n📊 Evaluation Results:")
    print("=" * 60)
    
    # Predictions
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)
    
    # Overall accuracy
    acc = accuracy_score(y_test, y_pred)
    print(f"\n🎯 Overall Accuracy: {acc*100:.1f}%")
    
    # Per-class accuracy
    print(f"\nPer-class breakdown:")
    target_names = ["Home Win", "Draw", "Away Win"]
    print(classification_report(y_test, y_pred, target_names=target_names))
    
    # Log loss
    ll = log_loss(y_test, y_proba)
    print(f"Log Loss: {ll:.4f}")
    
    # Confidence-weighted accuracy
    max_proba = np.max(y_proba, axis=1)
    high_conf_mask = max_proba >= 0.5
    if high_conf_mask.sum() > 0:
        high_conf_acc = accuracy_score(y_test[high_conf_mask], y_pred[high_conf_mask])
        print(f"\n🔥 High-confidence (≥50%): {high_conf_mask.sum()} matches, {high_conf_acc*100:.1f}% accuracy")
    
    high_conf_mask2 = max_proba >= 0.6
    if high_conf_mask2.sum() > 0:
        high_conf_acc2 = accuracy_score(y_test[high_conf_mask2], y_pred[high_conf_mask2])
        print(f"🔥 High-confidence (≥60%): {high_conf_mask2.sum()} matches, {high_conf_acc2*100:.1f}% accuracy")
    
    high_conf_mask3 = max_proba >= 0.7
    if high_conf_mask3.sum() > 0:
        high_conf_acc3 = accuracy_score(y_test[high_conf_mask3], y_pred[high_conf_mask3])
        print(f"🔥 High-confidence (≥70%): {high_conf_mask3.sum()} matches, {high_conf_acc3*100:.1f}% accuracy")
    
    # ─── Feature Importance ──────────────────────
    print(f"\n📊 Top 20 Feature Importances:")
    importance = model.feature_importances_
    feat_imp = sorted(zip(feature_cols, importance), key=lambda x: x[1], reverse=True)
    for name, imp in feat_imp[:20]:
        bar = "█" * int(imp * 100)
        print(f"   {name:30s} {imp:.4f} {bar}")
    
    # ─── Accuracy by confidence bucket ───────────
    print(f"\n📊 Calibration by Confidence Bucket:")
    print(f"   {'Bucket':>12} {'Count':>6} {'Pred Acc':>10} {'Actual':>10}")
    print(f"   {'-'*42}")
    
    for low, high in [(0.3, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.01)]:
        mask = (max_proba >= low) & (max_proba < high)
        if mask.sum() > 0:
            bucket_acc = accuracy_score(y_test[mask], y_pred[mask])
            avg_conf = max_proba[mask].mean()
            print(f"   {low*100:.0f}-{high*100:.0f}%{' ':>6} {mask.sum():>6} {avg_conf*100:>9.1f}% {bucket_acc*100:>9.1f}%")
    
    # ─── Most common errors ──────────────────────
    print(f"\n📊 Error Analysis:")
    errors = np.where(y_pred != y_test)[0]
    if len(errors) > 0:
        error_types = defaultdict(int)
        for idx in errors:
            true_label = target_names[y_test[idx]]
            pred_label = target_names[y_pred[idx]]
            error_types[f"{true_label} → {pred_label}"] += 1
        
        print(f"   Total errors: {len(errors)}/{len(y_test)} ({len(errors)/len(y_test)*100:.1f}%)")
        for err_type, count in sorted(error_types.items(), key=lambda x: -x[1]):
            print(f"     {err_type}: {count} ({count/len(errors)*100:.1f}%)")
    
    # ─── Save Model ──────────────────────────────
    model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    os.makedirs(model_dir, exist_ok=True)
    
    model_path = os.path.join(model_dir, "xgboost_1x2_v5.json")
    model.save_model(model_path)
    print(f"\n💾 Model saved: {model_path}")
    
    # Save metadata
    meta = {
        "version": "v5",
        "accuracy": float(acc),
        "log_loss": float(ll),
        "n_features": len(feature_cols),
        "n_train": len(train_df),
        "n_test": len(test_df),
        "train_date": str(datetime.now()),
        "feature_names": feature_cols,
        "feature_importance": {name: float(imp) for name, imp in feat_imp},
        "test_period": f"{test_df['date'].iloc[0][:10]} → {test_df['date'].iloc[-1][:10]}",
        "high_confidence_50": float(high_conf_acc) if high_conf_mask.sum() > 0 else 0,
        "high_confidence_60": float(high_conf_acc2) if high_conf_mask2.sum() > 0 else 0,
        "high_confidence_70": float(high_conf_acc3) if high_conf_mask3.sum() > 0 else 0,
    }
    
    meta_path = os.path.join(model_dir, "xgboost_1x2_v5_meta.json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"📋 Metadata saved: {meta_path}")
    
    print(f"\n{'='*60}")
    print(f"✅ Training complete!")
    print(f"   Model: XGBoost 1X2 v5")
    print(f"   Accuracy: {acc*100:.1f}%")
    print(f"   High-conf (≥60%): {high_conf_mask2.sum()} matches, {high_conf_acc2*100:.1f}% accuracy" if high_conf_mask2.sum() > 0 else "")
    print(f"   Features: {len(feature_cols)}")
    print(f"{'='*60}")
    
    return acc


if __name__ == "__main__":
    main()
