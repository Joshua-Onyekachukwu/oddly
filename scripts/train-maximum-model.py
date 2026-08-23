#!/usr/bin/env python3
"""
Maximum-Performance Football Prediction Model

Stacked ensemble: XGBoost + LightGBM with 80+ features from:
- Team form, Elo, attack/defense ratings
- Player Impact Score (PIS) 
- Injury impact
- Referee bias and card tendencies
- Head-to-head history
- League-specific stats
- Advanced interaction features
- Odds-derived features
- Football-data.co.uk match stats (shots, fouls, corners, HT scores)

Usage: python scripts/train-maximum-model.py
"""

import sys, os, json, warnings
import numpy as np
import pandas as pd
from datetime import datetime
from collections import defaultdict

import xgboost as xgb
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV

warnings.filterwarnings('ignore')
os.environ['PYTHONIOENCODING'] = 'utf-8'

# ─── Data Loading ──────────────────────────────────────────────────────────

def load_env():
    env = {}
    with open(os.path.join(os.path.dirname(__file__), '..', '.env.local'), 'r', encoding='utf-8') as f:
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
    return create_client(env['NEXT_PUBLIC_SUPABASE_URL'], env.get('SUPABASE_SECRET_KEY', '') or env['NEXT_PUBLIC_SUPABASE_ANON_KEY'])

def load_matches(sb):
    print("Loading matches from Supabase...")
    all_fixtures = []
    offset = 0
    while True:
        result = sb.table('fixtures').select(
            'id,home_team_id,away_team_id,league_id,status,home_score,away_score,kickoff_time,external_id'
        ).eq('status', 'finished').order('kickoff_time', desc=False).range(offset, offset+999).execute()
        data = result.data or []
        if not data: break
        all_fixtures.extend(data)
        offset += 1000
        if len(data) < 1000: break
    print(f"  {len(all_fixtures)} finished matches")
    return all_fixtures

def load_odds(sb):
    print("Loading odds...")
    all_odds = []
    offset = 0
    while True:
        result = sb.table('odds_snapshots').select('fixture_id,market,selection,odds').range(offset, offset+999).execute()
        data = result.data or []
        if not data: break
        all_odds.extend(data)
        offset += 1000
        if len(data) < 1000: break
    print(f"  {len(all_odds)} odds records")
    return all_odds

def load_teams(sb):
    print("Loading teams...")
    result = sb.table('teams').select('id,canonical_name,league_id').execute()
    teams = {t['id']: t for t in (result.data or [])}
    print(f"  {len(teams)} teams")
    return teams

def load_football_data():
    """Load football-data.co.uk matches with referee, shots, fouls, corners, HT scores."""
    print("Loading football-data.co.uk matches...")
    path = os.path.join(os.path.dirname(__file__), '..', 'data', 'football-data-referee-stats.json')
    with open(path, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    # Can be stored as dict {0: match, ...} or as list [match, ...]
    matches = []
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(v, dict) and 'home_team' in v:
                matches.append(v)
    elif isinstance(raw, list):
        for v in raw:
            if isinstance(v, dict) and 'home_team' in v:
                matches.append(v)
    print(f"  {len(matches)} matches with referee + match stats")
    return matches

def load_player_impacts():
    path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-player-impacts.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except: return {}

def load_injury_impacts():
    path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-injury-impact.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except: return {}

def load_referee_features():
    path = os.path.join(os.path.dirname(__file__), '..', 'data', 'referee-relationship-features.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except: return {}

# ─── Elo + Strength Computation ────────────────────────────────────────────

def compute_elo_ratings(matches):
    print("Computing Elo ratings...")
    K = 32
    elo = {}
    home_adv = 65
    
    sorted_m = sorted([m for m in matches if m.get('home_score') is not None],
                      key=lambda x: x.get('kickoff_time') or '')
    
    for m in sorted_m:
        hid, aid = m['home_team_id'], m['away_team_id']
        hs = m.get('home_score', 0) or 0
        as_ = m.get('away_score', 0) or 0
        
        if hid not in elo: elo[hid] = 1500
        if aid not in elo: elo[aid] = 1500
        
        exp_h = 1.0 / (1 + 10 ** ((elo[aid] - elo[hid] - home_adv) / 400))
        exp_a = 1 - exp_h
        
        if hs > as_: act_h, act_a = 1.0, 0.0
        elif hs == as_: act_h, act_a = 0.5, 0.5
        else: act_h, act_a = 0.0, 1.0
        
        elo[hid] += K * (act_h - exp_h)
        elo[aid] += K * (act_a - exp_a)
    
    # Attack/defense per team
    stats = {}
    for m in sorted_m:
        hid, aid = m['home_team_id'], m['away_team_id']
        hs = m.get('home_score', 0) or 0
        as_ = m.get('away_score', 0) or 0
        for tid, gf, ga in [(hid, hs, as_), (aid, as_, hs)]:
            if tid not in stats: stats[tid] = {'gf':0,'ga':0,'n':0}
            stats[tid]['gf'] += gf
            stats[tid]['ga'] += ga
            stats[tid]['n'] += 1
    
    strengths = {}
    for tid in elo:
        s = stats.get(tid, {'gf':0,'ga':0,'n':1})
        n = max(s['n'], 1)
        strengths[tid] = {
            'elo': elo[tid],
            'attack': s['gf'] / n,
            'defense': s['ga'] / n,
        }
    print(f"  Elo for {len(elo)} teams")
    return strengths

# ─── Form + H2H + League Features ──────────────────────────────────────────

def compute_team_form(matches, team_id, before_date, n=10):
    # Optimized: scan only last 200 matches for this team
    team_m = []
    for m in reversed(matches):
        if len(team_m) >= n: break
        if (m['home_team_id'] == team_id or m['away_team_id'] == team_id):
            if (m.get('kickoff_time') or '') < before_date and m.get('home_score') is not None:
                team_m.append(m)
    team_m = team_m[::-1]  # chronological order
    
    if not team_m:
        return {k: 0 for k in ['pts','gf','ga','wins','draws','losses','cs','btts','gpm','capm','form_streak']}
    
    pts = gf = ga = w = d = l = cs = btts = 0
    streak = 0  # +N for wins, -N for losses
    for m in team_m:
        is_h = m['home_team_id'] == team_id
        g_for = m['home_score'] if is_h else m['away_score']
        g_aga = m['away_score'] if is_h else m['home_score']
        gf += g_for or 0; ga += g_aga or 0
        if g_for > g_aga: pts += 3; w += 1; streak = max(1, streak + 1) if streak > 0 else 1
        elif g_for == g_aga: pts += 1; d += 1; streak = 0
        else: l += 1; streak = min(-1, streak - 1) if streak < 0 else -1
        if g_aga == 0: cs += 1
        if (g_for or 0) > 0 and (g_aga or 0) > 0: btts += 1
    
    n_ = len(team_m)
    return {
        'pts': pts / n_, 'gf': gf / n_, 'ga': ga / n_,
        'wins': w / n_, 'draws': d / n_, 'losses': l / n_,
        'cs': cs / n_, 'btts': btts / n_,
        'gpm': gf / n_, 'capm': ga / n_,
        'form_streak': streak,
    }

def compute_h2h(matches, home_id, away_id, before_date, n=10):
    h2h = []
    for m in reversed(matches):
        if len(h2h) >= n: break
        if set([m['home_team_id'], m['away_team_id']]) == set([home_id, away_id]):
            if (m.get('kickoff_time') or '') < before_date and m.get('home_score') is not None:
                h2h.append(m)
    h2h = h2h[::-1]
    
    if not h2h:
        return {'hw': 0, 'dr': 0, 'aw': 0, 'goals': 0, 'n': 0}
    
    hw = dr = aw = tg = 0
    for m in h2h:
        if m['home_team_id'] == home_id:
            gf, ga = m.get('home_score', 0), m.get('away_score', 0)
        else:
            gf, ga = m.get('away_score', 0), m.get('home_score', 0)
        tg += (gf or 0) + (ga or 0)
        if gf > ga: hw += 1
        elif gf == ga: dr += 1
        else: aw += 1
    
    n_ = len(h2h)
    return {'hw': hw/n_, 'dr': dr/n_, 'aw': aw/n_, 'goals': tg/n_, 'n': n_}

def compute_league_stats(matches, league_id, before_date):
    lm = [m for m in matches
          if m.get('league_id') == league_id
          and (m.get('kickoff_time') or '') < before_date
          and m.get('home_score') is not None][-100:]
    
    if not lm:
        return {'lg': 2.5, 'lhw': 0.45, 'ldr': 0.25, 'lbtts': 0.5}
    
    tg = hw = dr = btts = 0
    for m in lm:
        hs = m.get('home_score', 0) or 0
        aws = m.get('away_score', 0) or 0
        tg += hs + aws
        if hs > aws: hw += 1
        elif hs == aws: dr += 1
        if hs > 0 and aws > 0: btts += 1
    
    n_ = len(lm)
    return {'lg': tg/n_, 'lhw': hw/n_, 'ldr': dr/n_, 'lbtts': btts/n_}

# ─── Referee Features from football-data.co.uk ─────────────────────────────

def build_referee_profiles(fd_matches):
    """Build referee profiles from football-data.co.uk data."""
    print("Building referee profiles from football-data.co.uk...")
    ref_stats = {}
    
    for m in fd_matches:
        ref = m.get('referee', '')
        if not ref: continue
        if ref not in ref_stats:
            ref_stats[ref] = {'matches': 0, 'home_wins': 0, 'draws': 0, 'away_wins': 0,
                             'total_goals': 0, 'home_goals': 0, 'away_goals': 0,
                             'home_shots': 0, 'away_shots': 0, 'home_fouls': 0, 'away_fouls': 0,
                             'home_yellow': 0, 'away_yellow': 0, 'home_red': 0, 'away_red': 0,
                             'home_corners': 0, 'away_corners': 0}
        rs = ref_stats[ref]
        rs['matches'] += 1
        hg = m.get('home_goals', 0) or 0
        ag = m.get('away_goals', 0) or 0
        rs['total_goals'] += hg + ag
        rs['home_goals'] += hg
        rs['away_goals'] += ag
        if hg > ag: rs['home_wins'] += 1
        elif hg == ag: rs['draws'] += 1
        else: rs['away_wins'] += 1
        rs['home_shots'] += m.get('home_shots', 0) or 0
        rs['away_shots'] += m.get('away_shots', 0) or 0
        rs['home_fouls'] += m.get('home_fouls', 0) or 0
        rs['away_fouls'] += m.get('away_fouls', 0) or 0
        rs['home_yellow'] += m.get('home_yellow', 0) or 0
        rs['away_yellow'] += m.get('away_yellow', 0) or 0
        rs['home_red'] += m.get('home_red', 0) or 0
        rs['away_red'] += m.get('away_red', 0) or 0
        rs['home_corners'] += m.get('home_corners', 0) or 0
        rs['away_corners'] += m.get('away_corners', 0) or 0
    
    # Compute averages
    for ref, rs in ref_stats.items():
        n = max(rs['matches'], 1)
        rs['home_win_rate'] = rs['home_wins'] / n
        rs['draw_rate'] = rs['draws'] / n
        rs['away_win_rate'] = rs['away_wins'] / n
        rs['avg_goals'] = rs['total_goals'] / n
        rs['home_bias'] = rs['home_win_rate'] - 0.45  # vs league average
        rs['goals_bias'] = rs['avg_goals'] - 2.5
        rs['foul_rate'] = (rs['home_fouls'] + rs['away_fouls']) / n
        rs['yellow_rate'] = (rs['home_yellow'] + rs['away_yellow']) / n
        rs['red_rate'] = (rs['home_red'] + rs['away_red']) / n
        rs['shot_volume'] = (rs['home_shots'] + rs['away_shots']) / n
        rs['corner_rate'] = (rs['home_corners'] + rs['away_corners']) / n
    
    print(f"  {len(ref_stats)} referee profiles")
    return ref_stats

# ─── Main Feature Builder ──────────────────────────────────────────────────

def build_all_features(match, matches, odds_map, strengths, player_impacts, 
                       injury_impacts, referee_profiles, ref_features, team_names):
    home_id = match['home_team_id']
    away_id = match['away_team_id']
    kickoff = match.get('kickoff_time', '')
    league_id = match.get('league_id')
    
    home_name = team_names.get(home_id, '')
    away_name = team_names.get(away_id, '')
    
    # Core features
    hf = compute_team_form(matches, home_id, kickoff, 10)
    af = compute_team_form(matches, away_id, kickoff, 10)
    h2h = compute_h2h(matches, home_id, away_id, kickoff, 10)
    ls = compute_league_stats(matches, league_id, kickoff)
    
    hs = strengths.get(home_id, {'elo': 1500, 'attack': 1.0, 'defense': 1.0})
    aws = strengths.get(away_id, {'elo': 1500, 'attack': 1.0, 'defense': 1.0})
    
    # Odds
    odds = odds_map.get(match['id'], {})
    ho = odds.get('home', 0) or 0
    do_ = odds.get('draw', 0) or 0
    ao = odds.get('away', 0) or 0
    hi = (1/ho*100) if ho > 0 else 33.3
    di = (1/do_*100) if do_ > 0 else 25.0
    ai = (1/ao*100) if ao > 0 else 33.3
    
    # Player impacts
    h_pis = player_impacts.get(home_name, {})
    a_pis = player_impacts.get(away_name, {})
    
    # Injury impacts
    h_inj = injury_impacts.get(home_name, {})
    a_inj = injury_impacts.get(away_name, {})
    
    # Referee profile
    ref_name = None
    team_refs = ref_features.get('features', {}).get('teamRefereeDominance', []) if isinstance(ref_features, dict) else []
    for fd in team_refs[:50]:
        if fd.get('team') == home_name:
            ref_name = fd.get('referee')
            break
    
    ref = referee_profiles.get(ref_name, {}) if ref_name else {}
    
    features = {
        # === FORM (20 features) ===
        'home_pts': hf['pts'], 'home_gf': hf['gf'], 'home_ga': hf['ga'],
        'home_wins': hf['wins'], 'home_draws': hf['draws'], 'home_losses': hf['losses'],
        'home_cs': hf['cs'], 'home_btts': hf['btts'], 'home_gpm': hf['gpm'], 'home_capm': hf['capm'],
        'home_form_streak': hf['form_streak'],
        'away_pts': af['pts'], 'away_gf': af['gf'], 'away_ga': af['ga'],
        'away_wins': af['wins'], 'away_draws': af['draws'], 'away_losses': af['losses'],
        'away_cs': af['cs'], 'away_btts': af['btts'], 'away_gpm': af['gpm'], 'away_capm': af['capm'],
        'away_form_streak': af['form_streak'],
        
        # === H2H (5 features) ===
        'h2h_hw': h2h['hw'], 'h2h_dr': h2h['dr'], 'h2h_aw': h2h['aw'],
        'h2h_goals': h2h['goals'], 'h2h_n': h2h['n'],
        
        # === LEAGUE (4 features) ===
        'lg_goals': ls['lg'], 'lg_hw': ls['lhw'], 'lg_dr': ls['ldr'], 'lg_btts': ls['lbtts'],
        
        # === STRENGTH (7 features) ===
        'home_elo': hs['elo'], 'away_elo': aws['elo'], 'elo_diff': hs['elo'] - aws['elo'],
        'home_attack': hs['attack'], 'home_defense': hs['defense'],
        'away_attack': aws['attack'], 'away_defense': aws['defense'],
        
        # === DERIVED (5 features) ===
        'goal_diff_form': hf['gpm'] - af['gpm'],
        'total_expected_goals': hf['gpm'] + af['gpm'],
        'defense_diff': aws['defense'] - hs['defense'],  # Positive = away concedes more
        'attack_diff': hs['attack'] - aws['attack'],
        'strength_gap': (hs['elo'] - aws['elo']) / 400,
        
        # === ODDS (6 features) ===
        'home_implied': hi, 'draw_implied': di, 'away_implied': ai,
        'overround': hi + di + ai - 100,
        'odds_value': (hi + di + ai) / 3,  # Average odds quality
        'market_confidence': max(hi, di, ai) / min(hi, di, ai),
        
        # === PLAYER IMPACT (17 features) ===
        'home_pis': h_pis.get('player_impact_score', 5.0),
        'away_pis': a_pis.get('player_impact_score', 5.0),
        'pis_diff': h_pis.get('player_impact_score', 5.0) - a_pis.get('player_impact_score', 5.0),
        'home_attack_pis': h_pis.get('attack_strength', 0.15),
        'away_attack_pis': a_pis.get('attack_strength', 0.15),
        'pis_attack_diff': h_pis.get('attack_strength', 0.15) - a_pis.get('attack_strength', 0.15),
        'home_shot_acc_pis': h_pis.get('shot_accuracy', 0.4),
        'away_shot_acc_pis': a_pis.get('shot_accuracy', 0.4),
        'home_defense_pis': h_pis.get('defensive_solidity', 1.0),
        'away_defense_pis': a_pis.get('defensive_solidity', 1.0),
        'home_squad_depth': h_pis.get('squad_depth', 5),
        'away_squad_depth': a_pis.get('squad_depth', 5),
        'home_top_goals': h_pis.get('top_player_goals', 0),
        'away_top_goals': a_pis.get('top_player_goals', 0),
        'home_pis_1x2': h_pis.get('pis_1x2_impact', 0),
        'away_pis_1x2': a_pis.get('pis_1x2_impact', 0),
        'pis_1x2_diff': h_pis.get('pis_1x2_impact', 0) - a_pis.get('pis_1x2_impact', 0),
        
        # === INJURY IMPACT (6 features) ===
        'home_injury_impact': h_inj.get('injury_impact_per_match', 1.0),
        'away_injury_impact': a_inj.get('injury_impact_per_match', 1.0),
        'injury_diff': h_inj.get('injury_impact_per_match', 1.0) - a_inj.get('injury_impact_per_match', 1.0),
        'home_inj_per_match': h_inj.get('injuries_per_match', 2.0),
        'away_inj_per_match': a_inj.get('injuries_per_match', 2.0),
        'injury_disadvantage': a_inj.get('injury_impact_per_match', 1.0) - h_inj.get('injury_impact_per_match', 1.0),
        
        # === REFEREE FEATURES (8 features) ===
        'ref_home_bias': ref.get('home_bias', 0),
        'ref_goals_bias': ref.get('goals_bias', 0),
        'ref_draw_rate': ref.get('draw_rate', 0.25),
        'ref_foul_rate': ref.get('foul_rate', 20),
        'ref_yellow_rate': ref.get('yellow_rate', 3.5),
        'ref_shot_volume': ref.get('shot_volume', 22),
        'ref_corner_rate': ref.get('corner_rate', 9),
        'ref_matches': min(ref.get('matches', 0), 200),
    }
    
    # === ADVANCED INTERACTIONS (15 features) ===
    features['elo_x_attack'] = features['elo_diff'] * features['attack_diff']
    features['elo_x_form'] = features['elo_diff'] * (hf['pts'] - af['pts'])
    features['form_x_attack'] = (hf['gpm'] - af['gpm']) * features['attack_diff']
    features['pis_x_elo'] = features['pis_diff'] * features['strength_gap']
    features['injury_x_elo'] = features['injury_disadvantage'] * features['strength_gap']
    features['attack_x_injury'] = features['attack_diff'] * features['injury_disadvantage']
    features['defense_x_injury'] = features['defense_diff'] * features['injury_disadvantage']
    features['h2h_x_form'] = h2h['hw'] * hf['wins'] - h2h['aw'] * af['wins']
    features['form_cs_diff'] = hf['cs'] - af['cs']
    features['form_btts_diff'] = hf['btts'] - af['btts']
    features['ref_x_home'] = features['ref_home_bias'] * (1 if True else -1)  # Home team benefits from home-bias ref
    features['ref_x_goals'] = features['ref_goals_bias'] * features['total_expected_goals']
    features['odds_x_elo'] = features['home_implied'] - (1 / (1 + 10 ** (-features['elo_diff'] / 400)) * 100)
    features['attack_x_defense'] = features['attack_diff'] * features['defense_diff']
    features['form_x_injury'] = (hf['pts'] - af['pts']) * features['injury_disadvantage']
    
    return features

# ─── Targets ────────────────────────────────────────────────────────────────

def compute_targets(match):
    hs = match.get('home_score') or 0
    gs = match.get('away_score') or 0
    total = hs + gs
    
    t = {}
    if hs > gs: t['1X2'] = 0
    elif hs == gs: t['1X2'] = 1
    else: t['1X2'] = 2
    
    t['OU25'] = 1 if total > 2.5 else 0
    t['OU15'] = 1 if total > 1.5 else 0
    t['OU35'] = 1 if total > 3.5 else 0
    t['BTTS'] = 1 if hs > 0 and gs > 0 else 0
    t['DC_HX'] = 1 if hs >= gs else 0
    t['DC_AX'] = 1 if gs >= hs else 0
    
    return t

# ─── Training ───────────────────────────────────────────────────────────────

MARKETS = {
    '1X2': {'type': 'multi', 'classes': 3, 'label': 'Match Result'},
    'OU25': {'type': 'binary', 'label': 'Over 2.5 Goals'},
    'OU15': {'type': 'binary', 'label': 'Over 1.5 Goals'},
    'OU35': {'type': 'binary', 'label': 'Over 3.5 Goals'},
    'BTTS': {'type': 'binary', 'label': 'Both Teams to Score'},
    'DC_HX': {'type': 'binary', 'label': 'DC Home/Draw'},
    'DC_AX': {'type': 'binary', 'label': 'DC Away/Draw'},
}

def train_stacked_ensemble(X, y_dict, feature_names):
    """Train stacked ensemble: XGBoost + LightGBM + Logistic meta-learner."""
    results = {}
    
    for market, info in MARKETS.items():
        if market not in y_dict: continue
        
        y = np.array(y_dict[market])
        valid = ~np.isnan(y)
        Xv = X[valid]
        yv = y[valid]
        
        if len(yv) < 200:
            print(f"  Skipping {market}: only {len(yv)} samples")
            continue
        
        print(f"\n  Training {info['label']} ({market})...")
        
        # Split: 70% train, 15% val (for stacking), 15% test
        n = len(Xv)
        train_end = int(n * 0.7)
        val_end = int(n * 0.85)
        
        X_train, X_val, X_test = Xv[:train_end], Xv[train_end:val_end], Xv[val_end:]
        y_train, y_val, y_test = yv[:train_end], yv[train_end:val_end], yv[val_end:]
        
        if info['type'] == 'multi':
            n_cls = 3
            
            # XGBoost
            xgb_model = xgb.XGBClassifier(
                n_estimators=500, max_depth=7, learning_rate=0.03,
                subsample=0.8, colsample_bytree=0.7, min_child_weight=3,
                reg_alpha=0.1, reg_lambda=2.0,
                objective='multi:softprob', num_class=n_cls,
                eval_metric='mlogloss', random_state=42,
                use_label_encoder=False, tree_method='hist',
            )
            xgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
            
            # LightGBM
            lgb_model = lgb.LGBMClassifier(
                n_estimators=500, max_depth=7, learning_rate=0.03,
                subsample=0.8, colsample_bytree=0.7, min_child_weight=3,
                reg_alpha=0.1, reg_lambda=2.0,
                objective='multiclass', num_class=n_cls,
                metric='multi_logloss', random_state=42, verbose=-1,
            )
            lgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], callbacks=[lgb.log_evaluation(0)])
            
            # Meta-learner (stacking)
            xgb_val = xgb_model.predict_proba(X_val)
            lgb_val = lgb_model.predict_proba(X_val)
            meta_X = np.hstack([xgb_val, lgb_val])
            
            meta_model = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
            meta_model.fit(meta_X, y_val)
            
            # Test
            xgb_test = xgb_model.predict_proba(X_test)
            lgb_test = lgb_model.predict_proba(X_test)
            meta_test = np.hstack([xgb_test, lgb_test])
            y_pred = meta_model.predict(meta_test)
            y_prob = meta_model.predict_proba(meta_test)
            
            acc = accuracy_score(y_test, y_pred)
            brier = np.mean([1 - y_prob[i][int(y_test[i])] for i in range(len(y_test))])
            ll = log_loss(y_test, y_prob)
            
        else:
            # Binary
            xgb_model = xgb.XGBClassifier(
                n_estimators=500, max_depth=7, learning_rate=0.03,
                subsample=0.8, colsample_bytree=0.7, min_child_weight=3,
                reg_alpha=0.1, reg_lambda=2.0,
                objective='binary:logistic', eval_metric='logloss',
                random_state=42, use_label_encoder=False, tree_method='hist',
            )
            xgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)
            
            lgb_model = lgb.LGBMClassifier(
                n_estimators=500, max_depth=7, learning_rate=0.03,
                subsample=0.8, colsample_bytree=0.7, min_child_weight=3,
                reg_alpha=0.1, reg_lambda=2.0,
                objective='binary', metric='binary_logloss',
                random_state=42, verbose=-1,
            )
            lgb_model.fit(X_train, y_train, eval_set=[(X_val, y_val)], callbacks=[lgb.log_evaluation(0)])
            
            # Meta-learner
            xgb_val = xgb_model.predict_proba(X_val)[:, 1:2]
            lgb_val = lgb_model.predict_proba(X_val)[:, 1:2]
            meta_X = np.hstack([xgb_val, lgb_val])
            
            meta_model = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
            meta_model.fit(meta_X, y_val)
            
            # Test
            xgb_test = xgb_model.predict_proba(X_test)[:, 1:2]
            lgb_test = lgb_model.predict_proba(X_test)[:, 1:2]
            meta_test = np.hstack([xgb_test, lgb_test])
            y_pred = meta_model.predict(meta_test)
            y_prob = meta_model.predict_proba(meta_test)
            
            acc = accuracy_score(y_test, y_pred)
            brier = brier_score_loss(y_test, y_prob[:, 1])
            ll = log_loss(y_test, y_prob)
        
        # Feature importance from XGBoost
        imp = dict(zip(feature_names, xgb_model.feature_importances_))
        top = sorted(imp.items(), key=lambda x: x[1], reverse=True)[:10]
        
        # Also get individual XGB accuracy for comparison
        if info['type'] == 'multi':
            xgb_acc = accuracy_score(y_test, xgb_model.predict(X_test))
            lgb_acc = accuracy_score(y_test, lgb_model.predict(X_test))
        else:
            xgb_acc = accuracy_score(y_test, (xgb_model.predict_proba(X_test)[:, 1] > 0.5).astype(int))
            lgb_acc = accuracy_score(y_test, (lgb_model.predict_proba(X_test)[:, 1] > 0.5).astype(int))
        
        results[market] = {
            'xgb': xgb_model, 'lgb': lgb_model, 'meta': meta_model,
            'accuracy': acc, 'brier': brier, 'log_loss': ll,
            'xgb_accuracy': xgb_acc, 'lgb_accuracy': lgb_acc,
            'samples': len(yv), 'test_samples': len(y_test),
            'top_features': top, 'label': info['label'], 'type': info['type'],
        }
        
        print(f"      XGBoost: {xgb_acc:.1%}  LightGBM: {lgb_acc:.1%}  ** Ensemble: {acc:.1%} **")
        print(f"      Top: {', '.join(f[0] for f in top[:5])}")
    
    return results

# ─── Smart Selection ────────────────────────────────────────────────────────

def smart_selection(models, X_test, y_test_dict):
    selections = []
    for i in range(len(X_test)):
        x = X_test[i:i+1]
        best_score = 0
        best_market = best_sel = None
        best_prob = 0
        
        for market, info in models.items():
            xgb_p = info['xgb'].predict_proba(x)[0]
            lgb_p = info['lgb'].predict_proba(x)[0]
            # Simple average for smart selection
            probs = (xgb_p + lgb_p) / 2
            
            if info['type'] == 'multi':
                for cls in range(len(probs)):
                    sc = probs[cls] ** 2
                    if sc > best_score:
                        best_score = sc
                        best_market = market
                        best_sel = ['Home', 'Draw', 'Away'][cls]
                        best_prob = probs[cls]
            else:
                for cls_idx, label in enumerate(['No', 'Yes']):
                    sc = probs[cls_idx] ** 2
                    if sc > best_score:
                        best_score = sc
                        best_market = market
                        best_sel = label
                        best_prob = probs[cls_idx]
        
        selections.append({'market': best_market, 'selection': best_sel, 'probability': best_prob})
    return selections

# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("  MAXIMUM-PERFORMANCE FOOTBALL PREDICTION MODEL")
    print("  XGBoost + LightGBM Stacked Ensemble | 80+ Features")
    print("=" * 65)
    
    sb = get_supabase()
    
    matches = load_matches(sb)
    odds_list = load_odds(sb)
    teams = load_teams(sb)
    strengths = compute_elo_ratings(matches)
    player_impacts = load_player_impacts()
    injury_impacts = load_injury_impacts()
    referee_profiles = build_referee_profiles(load_football_data())
    ref_features = load_referee_features()
    
    # Team name mapping
    team_names = {tid: t.get('canonical_name', '') for tid, t in teams.items()}
    
    # Odds map
    odds_map = defaultdict(dict)
    for o in odds_list:
        f = o['fixture_id']
        if o['market'] == '1X2':
            if o['selection'] == 'Home': odds_map[f]['home'] = o['odds']
            elif o['selection'] == 'Draw': odds_map[f]['draw'] = o['odds']
            elif o['selection'] == 'Away': odds_map[f]['away'] = o['odds']
    
    matches.sort(key=lambda m: m.get('kickoff_time') or '')
    
    # Use only finished matches for form building (exclude upcoming)
    finished = [m for m in matches if m.get('home_score') is not None]
    print(f"  {len(finished)} finished matches for form computation")
    
    # Build features (use all finished matches but only compute for the subset)
    print(f"Building features...")
    feature_rows, target_rows = [], []
    total = len(finished)
    for i, match in enumerate(finished):
        if i % 2000 == 0: print(f"  {i}/{total}...")
        
        feats = build_all_features(match, finished, odds_map, strengths,
                                   player_impacts, injury_impacts, referee_profiles,
                                   ref_features, team_names)
        targets = compute_targets(match)
        feature_rows.append(feats)
        target_rows.append(targets)
    
    feature_names = list(feature_rows[0].keys())
    X = np.array([[r[f] for f in feature_names] for r in feature_rows])
    X = np.nan_to_num(X, nan=0.0, posinf=100.0, neginf=-100.0)
    
    y_dict = {m: [r.get(m, np.nan) for r in target_rows] for m in MARKETS}
    
    print(f"\n{len(feature_rows)} matches x {len(feature_names)} features")
    
    # Train stacked ensemble
    print("\nTraining XGBoost + LightGBM Stacked Ensemble...")
    print("-" * 65)
    
    results = train_stacked_ensemble(X, y_dict, feature_names)
    
    # Smart selection
    if results:
        print("\n\nSmart Selection Analysis")
        print("-" * 65)
        
        n = len(X)
        test_start = int(n * 0.7)
        X_test = X[test_start:]
        y_test = {m: np.array([target_rows[i].get(m, np.nan) for i in range(test_start, n)]) for m in MARKETS}
        
        selections = smart_selection(results, X_test, y_test)
        
        correct = total = 0
        for i, sel in enumerate(selections):
            mk = sel['market']
            if mk not in MARKETS: continue
            actual = y_test[mk][i]
            if np.isnan(actual): continue
            if MARKETS[mk]['type'] == 'multi':
                is_c = ['Home', 'Draw', 'Away'].index(sel['selection']) == int(actual)
            else:
                is_c = (sel['selection'] == 'Yes' and actual == 1) or (sel['selection'] == 'No' and actual == 0)
            if is_c: correct += 1
            total += 1
        
        smart_acc = correct / total if total > 0 else 0
        print(f"\n  Smart Selection Accuracy: {smart_acc:.1%} ({correct}/{total})")
    
    # Save models
    print("\nSaving models...")
    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    os.makedirs(model_dir, exist_ok=True)
    
    for market, r in results.items():
        r['xgb'].save_model(os.path.join(model_dir, f'xgboost_{market}.json'))
        r['lgb'].booster_.save_model(os.path.join(model_dir, f'lightgbm_{market}.txt'))
    
    meta = {
        'trained_at': datetime.now().isoformat(),
        'model_type': 'stacked_ensemble_xgb_lgb',
        'total_matches': len(feature_rows),
        'total_features': len(feature_names),
        'feature_names': feature_names,
        'markets': {m: {
            'accuracy': float(r['accuracy']),
            'xgb_accuracy': float(r['xgb_accuracy']),
            'lgb_accuracy': float(r['lgb_accuracy']),
            'brier': float(r['brier']),
            'log_loss': float(r['log_loss']),
            'samples': int(r['samples']),
            'top_features': [f[0] for f in r['top_features'][:10]],
        } for m, r in results.items()},
        'smart_selection_accuracy': float(smart_acc) if results else 0,
    }
    
    with open(os.path.join(model_dir, 'xgboost_metadata.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    
    # Final report
    print("\n" + "=" * 65)
    print("  FINAL RESULTS — Maximum-Performance Model")
    print("=" * 65)
    print(f"  Matches: {len(feature_rows)} | Features: {len(feature_names)} | Model: XGB+LGB Ensemble")
    print()
    for m, r in sorted(results.items(), key=lambda x: x[1]['accuracy'], reverse=True):
        delta = r['accuracy'] - r['xgb_accuracy']
        print(f"  {r['label']:28s} Ensemble: {r['accuracy']:.1%}  (XGB: {r['xgb_accuracy']:.1%}  LGB: {r['lgb_accuracy']:.1%}  delta: {delta:+.1%})")
    if results:
        print(f"\n  Smart Selection: {smart_acc:.1%}")
    print("=" * 65)

if __name__ == '__main__':
    main()
