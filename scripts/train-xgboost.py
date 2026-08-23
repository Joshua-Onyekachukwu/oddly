#!/usr/bin/env python3
"""
XGBoost Multi-Market Football Prediction Model

Trains gradient boosting models for each betting market using 30+ features:
- Team form (recent results, goals, xG)
- Home advantage
- Head-to-head history
- Odds-derived features
- Team strength (Elo, attack/defense ratings)
- League-specific factors
- Match context (rest days, travel, importance)

Usage:
  python scripts/train-xgboost.py [--predict] [--backtest]
"""

import sys
import json
import os
import argparse
from datetime import datetime, timedelta
from collections import defaultdict

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.calibration import CalibratedClassifierCV
import warnings
warnings.filterwarnings('ignore')

# ─── Supabase Connection ────────────────────────────────────────────────

def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, _, value = line.partition('=')
                value = value.strip('"').strip("'")
                env[key.strip()] = value
    return env

def get_supabase():
    from supabase import create_client
    env = load_env()
    url = env.get('NEXT_PUBLIC_SUPABASE_URL', '')
    key = env.get('SUPABASE_SECRET_KEY', '') or env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    return create_client(url, key)

# ─── Data Loading ────────────────────────────────────────────────────────

def load_matches(sb):
    """Load finished matches with all needed data."""
    print("📦 Loading matches from Supabase...")
    
    # Load fixtures with team info
    all_fixtures = []
    offset = 0
    while True:
        result = sb.table('fixtures').select(
            'id,home_team_id,away_team_id,league_id,status,'
            'home_score,away_score,kickoff_time,external_id'
        ).eq('status', 'finished').order('kickoff_time', desc=False).range(offset, offset+999).execute()
        
        data = result.data if result else []
        if not data:
            break
        all_fixtures.extend(data)
        offset += 1000
        if len(data) < 1000:
            break
    
    print(f"   Loaded {len(all_fixtures)} finished matches")
    return all_fixtures

def load_odds(sb):
    """Load odds snapshots."""
    print("📦 Loading odds...")
    
    all_odds = []
    offset = 0
    while True:
        result = sb.table('odds_snapshots').select(
            'fixture_id,market,selection,odds'
        ).range(offset, offset+999).execute()
        
        data = result.data if result else []
        if not data:
            break
        all_odds.extend(data)
        offset += 1000
        if len(data) < 1000:
            break
    
    print(f"   Loaded {len(all_odds)} odds records")
    return all_odds

def compute_elo_ratings(matches):
    """Compute Elo ratings for all teams from match history."""
    print("\U0001f4ca Computing Elo ratings from match history...")
    K = 32
    elo = {}
    home_advantage = 65
    
    # Sort by kickoff time
    sorted_matches = sorted([m for m in matches if m['home_score'] is not None],
                          key=lambda x: x['kickoff_time'] or '')
    
    for m in sorted_matches:
        home_id = m['home_team_id']
        away_id = m['away_team_id']
        hs = m['home_score'] or 0
        as_ = m['away_score'] or 0
        
        # Initialize new teams at 1500
        if home_id not in elo: elo[home_id] = 1500
        if away_id not in elo: elo[away_id] = 1500
        
        # Expected score
        exp_home = 1.0 / (1 + 10 ** ((elo[away_id] - elo[home_id] - home_advantage) / 400))
        exp_away = 1 - exp_home
        
        # Actual score
        if hs > as_: actual_home, actual_away = 1.0, 0.0
        elif hs == as_: actual_home, actual_away = 0.5, 0.5
        else: actual_home, actual_away = 0.0, 1.0
        
        # Update Elo
        elo[home_id] += K * (actual_home - exp_home)
        elo[away_id] += K * (actual_away - exp_away)
    
    # Compute attack/defense ratings
    team_stats = {}
    for m in sorted_matches:
        home_id = m['home_team_id']
        away_id = m['away_team_id']
        hs = m['home_score'] or 0
        as_ = m['away_score'] or 0
        
        for tid, gf, ga, is_home in [(home_id, hs, as_, True), (away_id, as_, hs, False)]:
            if tid not in team_stats:
                team_stats[tid] = {'gf': 0, 'ga': 0, 'n': 0, 'home_n': 0, 'away_n': 0, 'home_wins': 0, 'away_wins': 0}
            ts = team_stats[tid]
            ts['gf'] += gf
            ts['ga'] += ga
            ts['n'] += 1
            if is_home:
                ts['home_n'] += 1
                if gf > ga: ts['home_wins'] += 1
            else:
                ts['away_n'] += 1
                if gf > ga: ts['away_wins'] += 1
    
    strengths = {}
    for tid in elo:
        ts = team_stats.get(tid, {'gf': 0, 'ga': 0, 'n': 1, 'home_n': 0, 'away_n': 0, 'home_wins': 0, 'away_wins': 0})
        n = max(ts['n'], 1)
        strengths[tid] = {
            'elo_rating': round(elo[tid], 1),
            'attack_rating': round(ts['gf'] / n, 2),
            'defense_rating': round(ts['ga'] / n, 2),
            'home_advantage': round((ts['home_wins'] / max(ts['home_n'], 1) - ts['away_wins'] / max(ts['away_n'], 1)), 3) if ts['home_n'] > 0 and ts['away_n'] > 0 else 0,
        }
    
    print(f"   Computed Elo for {len(elo)} teams")
    return strengths

def load_teams(sb):
    """Load team data and compute strengths."""
    print("\U0001f4e6 Loading team data...")
    
    teams_result = sb.table('teams').select('id,canonical_name,league_id').execute()
    teams = {t['id']: t for t in (teams_result.data or [])}
    
    print(f"   Loaded {len(teams)} teams")
    return teams

def load_player_impacts():
    """Load player impact scores from local JSON file."""
    print("\U0001f3ae Loading player impact scores...")
    
    impact_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-player-impacts.json')
    try:
        with open(impact_path, 'r', encoding='utf-8') as f:
            impacts = json.load(f)
        print(f"   Loaded player impacts for {len(impacts)} teams")
        return impacts
    except FileNotFoundError:
        print("   ⚠️  player-team-impacts.json not found. Using defaults.")
        return {}

def load_injury_impacts():
    """Load team injury impact scores from local JSON file."""
    print("\U0001f3ae Loading injury impact scores...")
    
    impact_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-injury-impact.json')
    try:
        with open(impact_path, 'r', encoding='utf-8') as f:
            impacts = json.load(f)
        print(f"   Loaded injury impacts for {len(impacts)} teams")
        return impacts
    except FileNotFoundError:
        print("   ⚠️  team-injury-impact.json not found. Using defaults.")
        return {}

# ─── Feature Engineering ─────────────────────────────────────────────────

def compute_team_form(matches, team_id, before_date, n_matches=10):
    """Compute team form from last N matches before a date."""
    team_matches = [
        m for m in matches
        if (m['home_team_id'] == team_id or m['away_team_id'] == team_id)
        and m['kickoff_time'] < before_date
        and m['home_score'] is not None
    ]
    team_matches = team_matches[-n_matches:] if len(team_matches) > n_matches else team_matches
    
    if not team_matches:
        return {
            'form_points': 0, 'form_goals_for': 0, 'form_goals_against': 0,
            'form_wins': 0, 'form_draws': 0, 'form_losses': 0,
            'form_matches': 0, 'form_clean_sheets': 0, 'form_btts': 0,
            'form_goals_per_match': 0, 'form_conceded_per_match': 0,
        }
    
    points = 0
    goals_for = 0
    goals_against = 0
    wins = 0
    draws = 0
    losses = 0
    clean_sheets = 0
    btts = 0
    
    for m in team_matches:
        is_home = m['home_team_id'] == team_id
        gf = m['home_score'] if is_home else m['away_score']
        ga = m['away_score'] if is_home else m['home_score']
        
        goals_for += gf or 0
        goals_against += ga or 0
        
        if gf > ga:
            points += 3; wins += 1
        elif gf == ga:
            points += 1; draws += 1
        else:
            losses += 1
        
        if ga == 0: clean_sheets += 1
        if (gf or 0) > 0 and (ga or 0) > 0: btts += 1
    
    n = len(team_matches)
    return {
        'form_points': points / n,
        'form_goals_for': goals_for / n,
        'form_goals_against': goals_against / n,
        'form_wins': wins / n,
        'form_draws': draws / n,
        'form_losses': losses / n,
        'form_matches': n,
        'form_clean_sheets': clean_sheets / n,
        'form_btts': btts / n,
        'form_goals_per_match': goals_for / n,
        'form_conceded_per_match': goals_against / n,
    }

def compute_h2h(matches, home_id, away_id, before_date, n=10):
    """Compute head-to-head stats."""
    h2h = [
        m for m in matches
        if set([m['home_team_id'], m['away_team_id']]) == set([home_id, away_id])
        and m['kickoff_time'] < before_date
        and m['home_score'] is not None
    ][-n:]
    
    if not h2h:
        return {'h2h_home_wins': 0, 'h2h_draws': 0, 'h2h_away_wins': 0, 'h2h_goals_avg': 0, 'h2h_matches': 0}
    
    home_wins = 0; draws = 0; away_wins = 0; total_goals = 0
    for m in h2h:
        if m['home_team_id'] == home_id:
            gf, ga = m['home_score'], m['away_score']
        else:
            gf, ga = m['away_score'], m['home_score']
        total_goals += (gf or 0) + (ga or 0)
        if gf > ga: home_wins += 1
        elif gf == ga: draws += 1
        else: away_wins += 1
    
    n = len(h2h)
    return {
        'h2h_home_wins': home_wins / n,
        'h2h_draws': draws / n,
        'h2h_away_wins': away_wins / n,
        'h2h_goals_avg': total_goals / n,
        'h2h_matches': n,
    }

def compute_league_stats(matches, league_id, before_date):
    """Compute league-level statistics."""
    league_matches = [
        m for m in matches
        if m['league_id'] == league_id
        and m['kickoff_time'] < before_date
        and m['home_score'] is not None
    ][-100:]
    
    if not league_matches:
        return {'league_avg_goals': 2.5, 'league_home_win_rate': 0.45, 'league_draw_rate': 0.25, 'league_btts_rate': 0.5}
    
    total_goals = 0; home_wins = 0; draws = 0; btts = 0
    for m in league_matches:
        total_goals += (m['home_score'] or 0) + (m['away_score'] or 0)
        if m['home_score'] > m['away_score']: home_wins += 1
        elif m['home_score'] == m['away_score']: draws += 1
        if (m['home_score'] or 0) > 0 and (m['away_score'] or 0) > 0: btts += 1
    
    n = len(league_matches)
    return {
        'league_avg_goals': total_goals / n,
        'league_home_win_rate': home_wins / n,
        'league_draw_rate': draws / n,
        'league_btts_rate': btts / n,
    }

def build_features(match, matches, odds_map, teams, strengths, player_impacts=None, injury_impacts=None, team_names=None):
    """Build feature vector for a single match."""
    home_id = match['home_team_id']
    away_id = match['away_team_id']
    kickoff = match['kickoff_time']
    league_id = match['league_id']
    
    # Resolve team names for player impact lookup
    if team_names is None:
        team_names = {}
    home_name = team_names.get(home_id, '')
    away_name = team_names.get(away_id, '')
    home_pis = (player_impacts or {}).get(home_name, {})
    away_pis = (player_impacts or {}).get(away_name, {})
    home_inj = (injury_impacts or {}).get(home_name, {})
    away_inj = (injury_impacts or {}).get(away_name, {})
    
    # Team form
    home_form = compute_team_form(matches, home_id, kickoff, 10)
    away_form = compute_team_form(matches, away_id, kickoff, 10)
    
    # Head-to-head
    h2h = compute_h2h(matches, home_id, away_id, kickoff, 10)
    
    # League stats
    league_stats = compute_league_stats(matches, league_id, kickoff)
    
    # Strength data
    hs = strengths.get(home_id, {})
    as_ = strengths.get(away_id, {})
    
    # Odds-derived features
    odds = odds_map.get(match['id'], {})
    home_odds = odds.get('home', 0) or 0
    draw_odds = odds.get('draw', 0) or 0
    away_odds = odds.get('away', 0) or 0
    
    home_implied = (1 / home_odds * 100) if home_odds > 0 else 33.3
    draw_implied = (1 / draw_odds * 100) if draw_odds > 0 else 25.0
    away_implied = (1 / away_odds * 100) if away_odds > 0 else 33.3
    
    # Derived features
    goal_diff = home_form['form_goals_per_match'] - away_form['form_goals_per_match']
    strength_diff = (hs.get('elo_rating', 1500) or 1500) - (as_.get('elo_rating', 1500) or 1500)
    
    features = {
        # Form features (home)
        'home_form_points': home_form['form_points'],
        'home_form_goals_for': home_form['form_goals_for'],
        'home_form_goals_against': home_form['form_goals_against'],
        'home_form_wins': home_form['form_wins'],
        'home_form_draws': home_form['form_draws'],
        'home_form_losses': home_form['form_losses'],
        'home_form_clean_sheets': home_form['form_clean_sheets'],
        'home_form_btts': home_form['form_btts'],
        'home_form_goals_per_match': home_form['form_goals_per_match'],
        'home_form_conceded_per_match': home_form['form_conceded_per_match'],
        
        # Form features (away)
        'away_form_points': away_form['form_points'],
        'away_form_goals_for': away_form['form_goals_for'],
        'away_form_goals_against': away_form['form_goals_against'],
        'away_form_wins': away_form['form_wins'],
        'away_form_draws': away_form['form_draws'],
        'away_form_losses': away_form['form_losses'],
        'away_form_clean_sheets': away_form['form_clean_sheets'],
        'away_form_btts': away_form['form_btts'],
        'away_form_goals_per_match': away_form['form_goals_per_match'],
        'away_form_conceded_per_match': away_form['form_conceded_per_match'],
        
        # Head-to-head
        'h2h_home_wins': h2h['h2h_home_wins'],
        'h2h_draws': h2h['h2h_draws'],
        'h2h_away_wins': h2h['h2h_away_wins'],
        'h2h_goals_avg': h2h['h2h_goals_avg'],
        
        # League stats
        'league_avg_goals': league_stats['league_avg_goals'],
        'league_home_win_rate': league_stats['league_home_win_rate'],
        'league_draw_rate': league_stats['league_draw_rate'],
        'league_btts_rate': league_stats['league_btts_rate'],
        
        # Strength
        'home_elo': hs.get('elo_rating', 1500) or 1500,
        'away_elo': as_.get('elo_rating', 1500) or 1500,
        'elo_diff': strength_diff,
        'home_attack': hs.get('attack_rating', 1.0) or 1.0,
        'home_defense': hs.get('defense_rating', 1.0) or 1.0,
        'away_attack': as_.get('attack_rating', 1.0) or 1.0,
        'away_defense': as_.get('defense_rating', 1.0) or 1.0,
        
        # Derived
        'goal_diff': goal_diff,
        'total_expected_goals': home_form['form_goals_per_match'] + away_form['form_goals_per_match'],
        'home_advantage': 0.5,  # Base home advantage
        
        # Odds-derived
        'home_implied_prob': home_implied,
        'draw_implied_prob': draw_implied,
        'away_implied_prob': away_implied,
        'odds_home': home_odds,
        'odds_draw': draw_odds,
        'odds_away': away_odds,
        'market_overround': home_implied + draw_implied + away_implied - 100,
        
        # Player Impact Score features (17 features)
        'home_pis': home_pis.get('player_impact_score', 5.0),
        'away_pis': away_pis.get('player_impact_score', 5.0),
        'pis_diff': home_pis.get('player_impact_score', 5.0) - away_pis.get('player_impact_score', 5.0),
        'home_attack_pis': home_pis.get('attack_strength', 0.15),
        'away_attack_pis': away_pis.get('attack_strength', 0.15),
        'pis_attack_diff': home_pis.get('attack_strength', 0.15) - away_pis.get('attack_strength', 0.15),
        'home_shot_accuracy_pis': home_pis.get('shot_accuracy', 0.4),
        'away_shot_accuracy_pis': away_pis.get('shot_accuracy', 0.4),
        'home_defense_pis': home_pis.get('defensive_solidity', 1.0),
        'away_defense_pis': away_pis.get('defensive_solidity', 1.0),
        'home_squad_depth': home_pis.get('squad_depth', 5),
        'away_squad_depth': away_pis.get('squad_depth', 5),
        'home_top_player_goals': home_pis.get('top_player_goals', 0),
        'away_top_player_goals': away_pis.get('top_player_goals', 0),
        'home_1x2_pis_impact': home_pis.get('pis_1x2_impact', 0),
        'away_1x2_pis_impact': away_pis.get('pis_1x2_impact', 0),
        'pis_1x2_diff': home_pis.get('pis_1x2_impact', 0) - away_pis.get('pis_1x2_impact', 0),
        
        # Injury Impact features (6 new features)
        'home_injury_impact': home_inj.get('injury_impact_per_match', 1.0),
        'away_injury_impact': away_inj.get('injury_impact_per_match', 1.0),
        'injury_diff': home_inj.get('injury_impact_per_match', 1.0) - away_inj.get('injury_impact_per_match', 1.0),
        'home_injuries_per_match': home_inj.get('injuries_per_match', 2.0),
        'away_injuries_per_match': away_inj.get('injuries_per_match', 2.0),
        'injury_disadvantage': (home_inj.get('injury_impact_per_match', 1.0) - away_inj.get('injury_impact_per_match', 1.0)) * -1,  # Positive when away team is more injured
    }
    
    return features

# ─── Target Variables ────────────────────────────────────────────────────

def compute_targets(match):
    """Compute target variables for a match."""
    hs = match.get('home_score') or 0
    gs = match.get('away_score') or 0
    total = hs + gs
    
    targets = {}
    
    # 1X2
    if hs > gs: targets['1X2'] = 0  # Home
    elif hs == gs: targets['1X2'] = 1  # Draw
    else: targets['1X2'] = 2  # Away
    
    # Over/Under 2.5
    targets['OU25'] = 1 if total > 2.5 else 0
    
    # Over/Under 1.5
    targets['OU15'] = 1 if total > 1.5 else 0
    
    # Over/Under 3.5
    targets['OU35'] = 1 if total > 3.5 else 0
    
    # BTTS
    targets['BTTS'] = 1 if hs > 0 and gs > 0 else 0
    
    # Double Chance
    if hs >= gs: targets['DC_HX'] = 1  # Home or Draw
    else: targets['DC_HX'] = 0
    if gs >= hs: targets['DC_AX'] = 1  # Away or Draw
    else: targets['DC_AX'] = 0
    
    # Draw No Bet (Home)
    if hs > gs: targets['DNB_H'] = 1
    elif hs == gs: targets['DNB_H'] = 0.5  # Push
    else: targets['DNB_H'] = 0
    
    return targets

# ─── Model Training ──────────────────────────────────────────────────────

MARKETS = {
    '1X2': {'type': 'multi', 'classes': 3, 'label': 'Match Result'},
    'OU25': {'type': 'binary', 'label': 'Over 2.5 Goals'},
    'OU15': {'type': 'binary', 'label': 'Over 1.5 Goals'},
    'OU35': {'type': 'binary', 'label': 'Over 3.5 Goals'},
    'BTTS': {'type': 'binary', 'label': 'Both Teams to Score'},
    'DC_HX': {'type': 'binary', 'label': 'Double Chance Home/Draw'},
    'DC_AX': {'type': 'binary', 'label': 'Double Chance Away/Draw'},
}

def train_models(X, y_dict, feature_names):
    """Train XGBoost models for each market."""
    results = {}
    
    for market, info in MARKETS.items():
        if market not in y_dict:
            continue
        
        y = np.array(y_dict[market])
        valid_mask = ~np.isnan(y)
        X_valid = X[valid_mask]
        y_valid = y[valid_mask]
        
        if len(y_valid) < 100:
            print(f"   ⚠️  {market}: Not enough data ({len(y_valid)} samples)")
            continue
        
        print(f"\n   🎯 Training {info['label']} ({market})...")
        
        if info['type'] == 'multi':
            # Multi-class: 1X2
            model = xgb.XGBClassifier(
                n_estimators=300,
                max_depth=6,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=5,
                reg_alpha=0.1,
                reg_lambda=1.0,
                objective='multi:softprob',
                num_class=3,
                eval_metric='mlogloss',
                random_state=42,
                use_label_encoder=False,
            )
        else:
            # Binary
            model = xgb.XGBClassifier(
                n_estimators=300,
                max_depth=6,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=5,
                reg_alpha=0.1,
                reg_lambda=1.0,
                objective='binary:logistic',
                eval_metric='logloss',
                random_state=42,
                use_label_encoder=False,
            )
        
        # Time series split (80/20 chronological)
        split_idx = int(len(X_valid) * 0.8)
        X_train, X_test = X_valid[:split_idx], X_valid[split_idx:]
        y_train, y_test = y_valid[:split_idx], y_valid[split_idx:]
        
        # Train
        model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )
        
        # Evaluate
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        
        accuracy = accuracy_score(y_test, y_pred)
        
        if info['type'] == 'multi':
            brier = np.mean([1 - y_prob[i][int(y_test[i])] for i in range(len(y_test))])
            ll = log_loss(y_test, y_prob)
        else:
            brier = brier_score_loss(y_test, y_prob[:, 1])
            ll = log_loss(y_test, y_prob)
        
        # Feature importance
        importance = dict(zip(feature_names, model.feature_importances_))
        top_features = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:10]
        
        results[market] = {
            'model': model,
            'accuracy': accuracy,
            'brier': brier,
            'log_loss': ll,
            'samples': len(y_valid),
            'train_samples': len(y_train),
            'test_samples': len(y_test),
            'top_features': top_features,
            'label': info['label'],
            'type': info['type'],
        }
        
        print(f"      Accuracy: {accuracy:.1%}")
        print(f"      Brier:    {brier:.4f}")
        print(f"      Log loss: {ll:.4f}")
        print(f"      Top features: {', '.join(f[0] for f in top_features[:5])}")
    
    return results

# ─── Smart Selection (pick best market per match) ────────────────────────

def smart_selection(models, X_test, match_data):
    """For each match, pick the market with highest confidence × probability."""
    selections = []
    
    for i in range(len(X_test)):
        x = X_test[i:i+1]
        best_score = 0
        best_market = None
        best_selection = None
        best_prob = 0
        
        for market, info in models.items():
            model = info['model']
            probs = model.predict_proba(x)[0]
            
            if info['type'] == 'multi':
                for cls_idx in range(len(probs)):
                    prob = probs[cls_idx]
                    score = prob * prob  # confidence × probability
                    if score > best_score:
                        best_score = score
                        best_market = market
                        best_selection = ['Home', 'Draw', 'Away'][cls_idx]
                        best_prob = prob
            else:
                prob = probs[1]  # probability of positive class
                score = prob * prob
                if score > best_score:
                    best_score = score
                    best_market = market
                    best_selection = 'Yes'
                    best_prob = prob
                
                # Also check negative class
                neg_prob = probs[0]
                neg_score = neg_prob * neg_prob
                if neg_score > best_score:
                    best_score = neg_score
                    best_market = market
                    best_selection = 'No'
                    best_prob = neg_prob
        
        selections.append({
            'market': best_market,
            'selection': best_selection,
            'probability': best_prob,
            'score': best_score,
        })
    
    return selections

# ─── Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='XGBoost Football Prediction Model')
    parser.add_argument('--backtest', action='store_true', help='Run backtest evaluation')
    parser.add_argument('--predict', action='store_true', help='Generate predictions for upcoming matches')
    args = parser.parse_args()
    
    print("🔄 ODDLY XGBoost Multi-Market Prediction Model")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    
    sb = get_supabase()
    
    # Load data
    matches = load_matches(sb)
    odds_list = load_odds(sb)
    teams = load_teams(sb)
    strengths = compute_elo_ratings(matches)
    player_impacts = load_player_impacts()
    injury_impacts = load_injury_impacts()
    
    # Build team name -> ID mapping for player impact lookup
    team_names = {}
    for tid, t in teams.items():
        team_names[tid] = t.get('canonical_name', '')
    
    if len(matches) < 100:
        print("❌ Not enough matches for training. Need at least 100.")
        return
    
    # Build odds map
    odds_map = defaultdict(dict)
    for o in odds_list:
        fid = o['fixture_id']
        mkt = o['market']
        sel = o['selection']
        if mkt == '1X2':
            if sel == 'Home': odds_map[fid]['home'] = o['odds']
            elif sel == 'Draw': odds_map[fid]['draw'] = o['odds']
            elif sel == 'Away': odds_map[fid]['away'] = o['odds']
    
    # Sort matches chronologically
    matches.sort(key=lambda m: m['kickoff_time'] or '')
    
    # Build features
    print(f"\n🔧 Building features for {len(matches)} matches...")
    
    feature_rows = []
    target_rows = []
    match_ids = []
    
    for i, match in enumerate(matches):
        if i % 500 == 0:
            print(f"   Processing {i}/{len(matches)}...")
        
        if match['home_score'] is None:
            continue
        
        features = build_features(match, matches, odds_map, teams, strengths, player_impacts, injury_impacts, team_names)
        targets = compute_targets(match)
        
        feature_rows.append(features)
        target_rows.append(targets)
        match_ids.append(match['id'])
    
    print(f"   ✅ Built {len(feature_rows)} feature vectors with {len(feature_rows[0])} features")
    
    # Convert to arrays
    feature_names = list(feature_rows[0].keys())
    X = np.array([[row[f] for f in feature_names] for row in feature_rows])
    
    # Handle NaN/Inf
    X = np.nan_to_num(X, nan=0.0, posinf=100.0, neginf=-100.0)
    
    y_dict = {m: [row.get(m, np.nan) for row in target_rows] for m in MARKETS}
    
    # Train models
    print("\n🏋️ Training XGBoost models...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    
    results = train_models(X, y_dict, feature_names)
    
    # Smart selection evaluation
    if results:
        print("\n\n🎯 Smart Selection Analysis (best market per match)")
        print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        
        split_idx = int(len(X) * 0.8)
        X_test = X[split_idx:]
        y_test = {m: np.array([target_rows[i].get(m, np.nan) for i in range(split_idx, len(target_rows))]) for m in MARKETS}
        
        selections = smart_selection(results, X_test, None)
        
        correct = 0
        total = 0
        for i, sel in enumerate(selections):
            market = sel['market']
            if market not in MARKETS:
                continue
            
            actual = y_test[market][i]
            if np.isnan(actual):
                continue
            
            if MARKETS[market]['type'] == 'multi':
                predicted_cls = ['Home', 'Draw', 'Away'].index(sel['selection'])
                is_correct = predicted_cls == int(actual)
            else:
                is_correct = (sel['selection'] == 'Yes' and actual == 1) or (sel['selection'] == 'No' and actual == 0)
            
            if is_correct:
                correct += 1
            total += 1
        
        smart_acc = correct / total if total > 0 else 0
        print(f"   Smart Selection Accuracy: {smart_acc:.1%}")
        print(f"   (picked {total} predictions across all markets)")
        
        # Confidence breakdown
        conf_buckets = {'90-100%': [0, 0], '80-89%': [0, 0], '70-79%': [0, 0], '60-69%': [0, 0], '50-59%': [0, 0]}
        for i, sel in enumerate(selections):
            prob = sel['probability']
            bucket = f"{int(prob // 10) * 10}-{int(prob // 10) * 10 + 9}%"
            if bucket in conf_buckets:
                conf_buckets[bucket][1] += 1
                # Check if correct
                market = sel['market']
                if market in y_test:
                    actual = y_test[market][i]
                    if not np.isnan(actual):
                        if MARKETS[market]['type'] == 'multi':
                            if ['Home', 'Draw', 'Away'].index(sel['selection']) == int(actual):
                                conf_buckets[bucket][0] += 1
                        else:
                            if (sel['selection'] == 'Yes' and actual == 1) or (sel['selection'] == 'No' and actual == 0):
                                conf_buckets[bucket][0] += 1
        
        print(f"\n   Confidence Calibration:")
        for bucket, (correct_count, total_count) in conf_buckets.items():
            if total_count > 0:
                acc = correct_count / total_count
                print(f"     {bucket}: {acc:.1%} ({correct_count}/{total_count})")
    
    # Save models
    print("\n💾 Saving models...")
    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(model_dir, exist_ok=True)
    
    for market, result in results.items():
        model_path = os.path.join(model_dir, f'xgboost_{market}.json')
        result['model'].save_model(model_path)
        print(f"   ✅ {market}: {model_path}")
    
    # Save metadata
    meta = {
        'trained_at': datetime.now().isoformat(),
        'total_matches': len(feature_rows),
        'total_features': len(feature_names),
        'feature_names': feature_names,
        'markets': {m: {
            'accuracy': float(r['accuracy']),
            'brier': float(r['brier']),
            'log_loss': float(r['log_loss']),
            'samples': int(r['samples']),
            'top_features': [f[0] for f in r['top_features'][:10]],
        } for m, r in results.items()},
    }
    
    meta_path = os.path.join(model_dir, 'xgboost_metadata.json')
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"   ✅ Metadata: {meta_path}")
    
    # Final summary
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("📊 Final Results")
    print(f"   Matches trained on: {len(feature_rows)}")
    print(f"   Features per match: {len(feature_names)}")
    print(f"   Markets modeled:    {len(results)}")
    print()
    for market, result in sorted(results.items(), key=lambda x: x[1]['accuracy'], reverse=True):
        print(f"   {result['label']:30s} {result['accuracy']:.1%} accuracy | Brier: {result['brier']:.4f} | N: {result['samples']}")

if __name__ == '__main__':
    main()
