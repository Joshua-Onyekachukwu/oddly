#!/usr/bin/env python3
"""
Value Finder — Generate predictions for upcoming fixtures, compare against odds.

Loads the trained XGBoost + LightGBM models, builds features for each
scheduled fixture, generates probabilities, and finds edges vs bookmaker odds.
"""

import sys, os, json, warnings
import numpy as np
from collections import defaultdict
from datetime import datetime

import xgboost as xgb
import lightgbm as lgb

warnings.filterwarnings('ignore')

# ─── Environment ───────────────────────────────────────────────────────────

def load_env():
    env = {}
    with open(os.path.join(os.path.dirname(__file__), '..', '.env.local'), 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, _, value = line.partition('=')
                env[key.strip()] = value.strip('"').strip("'")
    return env

def get_sb():
    from supabase import create_client
    env = load_env()
    return create_client(env['NEXT_PUBLIC_SUPABASE_URL'], env.get('SUPABASE_SECRET_KEY', '') or env['NEXT_PUBLIC_SUPABASE_ANON_KEY'])

# ─── Data Loading ──────────────────────────────────────────────────────────

def load_all(sb, table, select, filters=None):
    """Paginated load."""
    all_data = []
    offset = 0
    while True:
        q = sb.table(table).select(select)
        for k, v in (filters or {}).items():
            q = q.eq(k, v)
        result = q.range(offset, offset + 999).execute()
        data = result.data or []
        if not data: break
        all_data.extend(data)
        offset += 1000
        if len(data) < 1000: break
    return all_data

def compute_elo(matches):
    elo, stats = {}, {}
    K, homeAdv = 32, 65
    sorted_m = sorted([m for m in matches if m.get('home_score') is not None],
                      key=lambda x: x.get('kickoff_time') or '')
    for m in sorted_m:
        hid, aid = m['home_team_id'], m['away_team_id']
        hs, as_ = m.get('home_score', 0) or 0, m.get('away_score', 0) or 0
        if hid not in elo: elo[hid] = 1500
        if aid not in elo: elo[aid] = 1500
        exp_h = 1 / (1 + 10 ** ((elo[aid] - elo[hid] - homeAdv) / 400))
        act_h = 1.0 if hs > as_ else (0.5 if hs == as_ else 0.0)
        elo[hid] += K * (act_h - exp_h)
        elo[aid] += K * ((1 - act_h) - (1 - exp_h))
        for tid, gf, ga in [(hid, hs, as_), (aid, as_, hs)]:
            if tid not in stats: stats[tid] = {'gf': 0, 'ga': 0, 'n': 0}
            stats[tid]['gf'] += gf; stats[tid]['ga'] += ga; stats[tid]['n'] += 1
    return {tid: {'elo': elo[tid], 'attack': stats.get(tid, {'gf':0,'n':1})['gf'] / max(stats.get(tid, {'n':1})['n'], 1),
                   'defense': stats.get(tid, {'ga':0,'n':1})['ga'] / max(stats.get(tid, {'n':1})['n'], 1)}
            for tid in elo}

def team_form(matches, team_id, before_date, n=10):
    team_m = []
    for m in reversed(matches):
        if len(team_m) >= n: break
        if (m['home_team_id'] == team_id or m['away_team_id'] == team_id):
            if (m.get('kickoff_time') or '') < before_date and m.get('home_score') is not None:
                team_m.append(m)
    team_m.reverse()
    if not team_m:
        return {k: 0 for k in ['pts','gf','ga','wins','draws','losses','cs','btts','gpm','capm','form_streak']}
    pts = gf = ga = w = d = l = cs = btts = streak = 0
    for m in team_m:
        is_h = m['home_team_id'] == team_id
        gF = m['home_score'] if is_h else m['away_score']
        gA = m['away_score'] if is_h else m['home_score']
        gf += gF or 0; ga += gA or 0
        if gF > gA: pts += 3; w += 1; streak = max(1, streak + 1) if streak > 0 else 1
        elif gF == gA: pts += 1; d += 1; streak = 0
        else: l += 1; streak = min(-1, streak - 1) if streak < 0 else -1
        if gA == 0: cs += 1
        if (gF or 0) > 0 and (gA or 0) > 0: btts += 1
    n_ = len(team_m)
    return {'pts': pts/n_, 'gf': gf/n_, 'ga': ga/n_, 'wins': w/n_, 'draws': d/n_, 'losses': l/n_,
            'cs': cs/n_, 'btts': btts/n_, 'gpm': gf/n_, 'capm': ga/n_, 'form_streak': streak}

def build_features(match, matches, strengths, player_impacts, injury_impacts, team_names):
    hid, aid = match['home_team_id'], match['away_team_id']
    kickoff = match.get('kickoff_time', '')
    hName = team_names.get(hid, '')
    aName = team_names.get(aid, '')
    
    hf = team_form(matches, hid, kickoff)
    af = team_form(matches, aid, kickoff)
    hs = strengths.get(hid, {'elo': 1500, 'attack': 1, 'defense': 1})
    aws = strengths.get(aid, {'elo': 1500, 'attack': 1, 'defense': 1})
    hp = player_impacts.get(hName, {})
    ap = player_impacts.get(aName, {})
    hi = injury_impacts.get(hName, {})
    ai = injury_impacts.get(aName, {})
    
    elo_diff = hs['elo'] - aws['elo']
    attack_diff = hs['attack'] - aws['attack']
    defense_diff = aws['defense'] - hs['defense']
    
    # 68-feature vector matching training exactly (feature order from metadata)
    h_home_implied = (1/33.3 * 100)
    h_draw_implied = (1/25.0 * 100)
    h_away_implied = (1/33.3 * 100)
    return [
        # Form (20) — indices 1-20
        hf['pts'], hf['gf'], hf['ga'], hf['wins'], hf['draws'], hf['losses'],
        hf['cs'], hf['btts'], hf['gpm'], hf['capm'],
        af['pts'], af['gf'], af['ga'], af['wins'], af['draws'], af['losses'],
        af['cs'], af['btts'], af['gpm'], af['capm'],
        # H2H (4) — indices 21-24
        0, 0.25, 0, 2.5,
        # League (4) — indices 25-28
        2.6, 0.45, 0.25, 0.52,
        # Strength (7) — indices 29-35
        hs['elo'], aws['elo'], elo_diff, hs['attack'], hs['defense'], aws['attack'], aws['defense'],
        # Derived (3) — indices 36-38
        hf['gpm'] - af['gpm'], hf['gpm'] + af['gpm'], 0.5,
        # Odds (7) — indices 39-45
        h_home_implied, h_draw_implied, h_away_implied, 33.3, 25.0, 33.3, 0,
        # Player Impact (17) — indices 46-62
        hp.get('player_impact_score', 5), ap.get('player_impact_score', 5),
        hp.get('player_impact_score', 5) - ap.get('player_impact_score', 5),
        hp.get('attack_strength', 0.15), ap.get('attack_strength', 0.15),
        hp.get('attack_strength', 0.15) - ap.get('attack_strength', 0.15),
        hp.get('shot_accuracy', 0.4), ap.get('shot_accuracy', 0.4),
        hp.get('defensive_solidity', 1), ap.get('defensive_solidity', 1),
        hp.get('squad_depth', 5), ap.get('squad_depth', 5),
        hp.get('top_player_goals', 0), ap.get('top_player_goals', 0),
        hp.get('pis_1x2_impact', 0), ap.get('pis_1x2_impact', 0),
        hp.get('pis_1x2_impact', 0) - ap.get('pis_1x2_impact', 0),
        # Injury (6) — indices 63-68
        hi.get('injury_impact_per_match', 1), ai.get('injury_impact_per_match', 1),
        hi.get('injury_impact_per_match', 1) - ai.get('injury_impact_per_match', 1),
        hi.get('injuries_per_match', 2), ai.get('injuries_per_match', 2),
        ai.get('injury_impact_per_match', 1) - hi.get('injury_impact_per_match', 1),
    ]

def build_1x2_features(match, matches, strengths, player_impacts, injury_impacts, team_names):
    """95-feature vector for the 1X2 model (68 base + 8 referee + 15 interaction + 4 extras)"""
    base = build_features(match, matches, strengths, player_impacts, injury_impacts, team_names)
    hid, aid = match['home_team_id'], match['away_team_id']
    hName = team_names.get(hid, '')
    aName = team_names.get(aid, '')
    hf = team_form(matches, hid, match.get('kickoff_time', ''))
    af = team_form(matches, aid, match.get('kickoff_time', ''))
    hs = strengths.get(hid, {'elo': 1500, 'attack': 1, 'defense': 1})
    aws = strengths.get(aid, {'elo': 1500, 'attack': 1, 'defense': 1})
    hp = player_impacts.get(hName, {})
    ap = player_impacts.get(aName, {})
    hi = injury_impacts.get(hName, {})
    ai = injury_impacts.get(aName, {})
    elo_diff = hs['elo'] - aws['elo']
    attack_diff = hs['attack'] - aws['attack']
    defense_diff = aws['defense'] - hs['defense']
    # Add 8 referee features (defaults)
    ref_features = [0, 0, 0.25, 22, 3.5, 22, 9, 50]
    # Add 15 interaction features
    interaction_features = [
        elo_diff * attack_diff,
        elo_diff * (hf['pts'] - af['pts']),
        (hf['gpm'] - af['gpm']) * attack_diff,
        (hp.get('player_impact_score',5) - ap.get('player_impact_score',5)) * (elo_diff / 400),
        (ai.get('injury_impact_per_match',1) - hi.get('injury_impact_per_match',1)) * (elo_diff / 400),
        attack_diff * (ai.get('injury_impact_per_match',1) - hi.get('injury_impact_per_match',1)),
        defense_diff * (ai.get('injury_impact_per_match',1) - hi.get('injury_impact_per_match',1)),
        0, hf['cs'] - af['cs'], hf['btts'] - af['btts'],
        0, 0, 33.3 - (1 / (1 + 10 ** (-elo_diff / 400)) * 100),
        attack_diff * defense_diff,
        (hf['pts'] - af['pts']) * (ai.get('injury_impact_per_match',1) - hi.get('injury_impact_per_match',1)),
    ]
    return base + ref_features + interaction_features

# ─── Markets ───────────────────────────────────────────────────────────────

MARKET_MAP = {
    'OU15': {'label': 'Over 1.5', 'yes': 'over_1.5', 'no': 'under_1.5'},
    'OU25': {'label': 'Over 2.5', 'yes': 'over_2.5', 'no': 'under_2.5'},
    'OU35': {'label': 'Over 3.5', 'yes': 'over_3.5', 'no': 'under_3.5'},
    'BTTS': {'label': 'BTTS', 'yes': 'yes', 'no': 'no'},
    'DC_HX': {'label': 'DC Home/Draw', 'yes': '1X', 'no': 'X2'},
    'DC_AX': {'label': 'DC Away/Draw', 'yes': 'X2', 'no': '1X'},
}

ODDS_TO_MODEL = {
    # Odds market|selection -> (model_market, model_selection_for_yes)
    ('1X2', 'Home'): ('1X2', 'Home'),
    ('1X2', 'Draw'): ('1X2', 'Draw'),
    ('1X2', 'Away'): ('1X2', 'Away'),
    ('over_under|over_2.5', 'over_2.5'): ('OU25', 'Yes'),
    ('over_under|under_2.5', 'under_2.5'): ('OU25', 'No'),
    ('over_under|over_1.5', 'over_1.5'): ('OU15', 'Yes'),
    ('over_under|under_3.5', 'under_3.5'): ('OU35', 'No'),
    ('btts', 'yes'): ('BTTS', 'Yes'),
    ('btts', 'no'): ('BTTS', 'No'),
}

# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("  VALUE FINDER — Ensemble Model vs Bookmaker Odds")
    print("=" * 65)
    
    sb = get_sb()
    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models')
    
    # Load models
    print("\nLoading trained models...")
    xgb_models, lgb_models = {}, {}
    for market in ['OU25', 'OU15', 'OU35', 'BTTS', 'DC_HX', 'DC_AX']:
        xgb_path = os.path.join(model_dir, f'xgboost_{market}.json')
        lgb_path = os.path.join(model_dir, f'lightgbm_{market}.txt')
        if os.path.exists(xgb_path):
            m = xgb.XGBClassifier()
            m.load_model(xgb_path)
            xgb_models[market] = m
        if os.path.exists(lgb_path):
            m = lgb.LGBMClassifier()
            m.booster_ = lgb.Booster(model_file=lgb_path)
            lgb_models[market] = m
    print(f"  Loaded {len(xgb_models)} XGBoost + {len(lgb_models)} LightGBM models")
    
    # Load data
    print("\nLoading data from Supabase...")
    finished = load_all(sb, 'fixtures', 'id,home_team_id,away_team_id,league_id,status,home_score,away_score,kickoff_time')
    scheduled = load_all(sb, 'fixtures', 'id,home_team_id,away_team_id,league_id,kickoff_time', {'status': 'scheduled'})
    teams_data = load_all(sb, 'teams', 'id,canonical_name')
    
    # Load odds for scheduled
    sched_ids = [f['id'] for f in scheduled]
    all_odds = load_all(sb, 'odds_snapshots', 'fixture_id,market,selection,odds')
    
    # Load local data
    pi_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-player-impacts.json')
    inj_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'team-injury-impact.json')
    player_impacts = json.load(open(pi_path, encoding='utf-8')) if os.path.exists(pi_path) else {}
    injury_impacts = json.load(open(inj_path, encoding='utf-8')) if os.path.exists(inj_path) else {}
    
    # Maps
    team_names = {t['id']: t['canonical_name'] for t in teams_data}
    strengths = compute_elo(finished)
    
    # Odds by fixture
    odds_by_fixture = defaultdict(dict)
    for o in all_odds:
        if o['fixture_id'] in sched_ids:
            odds_by_fixture[o['fixture_id']][o['market'] + '|' + o['selection']] = o['odds']
    
    print(f"  Finished: {len(finished)} | Scheduled: {len(scheduled)} | Odds: {len([f for f in sched_ids if f in odds_by_fixture])} fixtures with odds")
    
    # Generate predictions
    print(f"\nGenerating predictions for {len(scheduled)} scheduled fixtures...")
    
    edges = []
    predictions_stored = 0
    
    for fix in scheduled:
        fid = fix['id']
        fixtures_odds = odds_by_fixture.get(fid, {})
        if not fixtures_odds: continue
        
        home_name = team_names.get(fix['home_team_id'], 'Home')
        away_name = team_names.get(fix['away_team_id'], 'Away')
        
        x_68 = build_features(fix, finished, strengths, player_impacts, injury_impacts, team_names)
        x_95 = build_1x2_features(fix, finished, strengths, player_impacts, injury_impacts, team_names)
        
        for market, xgb_m in xgb_models.items():
            x = x_68
            x_pred = np.array([x])
            x_pred = np.array([x])
            
            # XGBoost prediction
            xgb_prob = xgb_m.predict_proba(x_pred)[0]
            
            # LightGBM prediction  
            if market in lgb_models:
                lgb_prob = lgb_models[market].predict_proba(x_pred)[0]
                # Ensemble average
                avg_prob = (xgb_prob + lgb_prob) / 2
            else:
                avg_prob = xgb_prob
            
            # Map to outcomes
            if market == '1X2':
                outcomes = {'Home': avg_prob[0], 'Draw': avg_prob[1], 'Away': avg_prob[2]}
                odds_map = {
                    'Home': fixtures_odds.get('1X2|Home'),
                    'Draw': fixtures_odds.get('1X2|Draw'),
                    'Away': fixtures_odds.get('1X2|Away'),
                }
            else:
                mm = MARKET_MAP[market]
                outcomes = {'Yes': avg_prob[1] if len(avg_prob) > 1 else avg_prob[0],
                           'No': avg_prob[0] if len(avg_prob) > 1 else 1 - avg_prob[0]}
                odds_map = {}
                for key, odds_val in fixtures_odds.items():
                    if 'over' in key.lower() and mm['yes'] in key.lower():
                        odds_map['Yes'] = odds_val
                    elif 'under' in key.lower() and mm['no'] in key.lower():
                        odds_map['No'] = odds_val
                    elif 'btts' in key.lower() and 'yes' in key.lower():
                        odds_map['Yes'] = odds_val
                    elif 'btts' in key.lower() and 'no' in key.lower():
                        odds_map['No'] = odds_val
            
            for outcome, model_prob in outcomes.items():
                if model_prob <= 0.01: continue
                book_odds = odds_map.get(outcome, 0)
                if not book_odds or book_odds <= 0: continue
                
                book_implied = 1 / book_odds
                edge = model_prob - book_implied
                ev_val = (model_prob * book_odds) - 1
                
                if edge > 0.005:  # Any positive edge
                    edges.append({
                        'fixture': f"{home_name} vs {away_name}",
                        'market': market,
                        'selection': outcome,
                        'model_prob': model_prob,
                        'book_implied': book_implied,
                        'book_odds': book_odds,
                        'edge': edge,
                        'ev': ev_val,
                        'tier': 'ELITE' if edge > 0.05 else ('HIGH' if edge > 0.03 else ('VALUE' if edge > 0.01 else 'MINOR')),
                    })
        
        predictions_stored += 1
    
    # Sort by edge
    edges.sort(key=lambda e: e['edge'], reverse=True)
    
    # ── Report ──
    
    print(f"\n{'═' * 65}")
    print(f"  RESULTS — {predictions_stored} fixtures analyzed, {len(edges)} edges found")
    print(f"{'═' * 65}")
    
    elite = [e for e in edges if e['tier'] == 'ELITE']
    high = [e for e in edges if e['tier'] == 'HIGH']
    value = [e for e in edges if e['tier'] == 'VALUE']
    minor = [e for e in edges if e['tier'] == 'MINOR']
    
    print(f"\n  🔥 ELITE edges (>5%): {len(elite)}")
    print(f"  ⭐ HIGH edges (3-5%): {len(high)}")
    print(f"  ✅ VALUE edges (1-3%): {len(value)}")
    print(f"  📊 MINOR edges (<1%): {len(minor)}")
    
    # Top 30
    print(f"\n  TOP 30 EDGES:")
    print(f"  {'─' * 63}")
    print(f"  {'Fixture':<28} {'Market':<10} {'Sel':<6} {'Model':>7} {'Book':>7} {'Edge':>7} {'Odds':>6} {'EV':>7}")
    print(f"  {'─' * 63}")
    
    for e in edges[:30]:
        icon = '🔥' if e['tier'] == 'ELITE' else ('⭐' if e['tier'] == 'HIGH' else ('✅' if e['tier'] == 'VALUE' else '  '))
        print(f"  {icon}{e['fixture'][:26]:<26} {e['market']:<10} {e['selection']:<6} "
              f"{e['model_prob']*100:>5.1f}% {e['book_implied']*100:>5.1f}% "
              f"{e['edge']*100:>+5.1f}% {e['book_odds']:>5.2f} {e['ev']*100:>+5.1f}%")
    
    # By market
    print(f"\n  EDGES BY MARKET:")
    by_market = {}
    for e in edges:
        if e['market'] not in by_market:
            by_market[e['market']] = {'count': 0, 'total_edge': 0, 'elite': 0}
        by_market[e['market']]['count'] += 1
        by_market[e['market']]['total_edge'] += e['edge']
        if e['tier'] == 'ELITE': by_market[e['market']]['elite'] += 1
    
    for m, v in sorted(by_market.items(), key=lambda x: -x[1]['total_edge']/max(x[1]['count'],1)):
        avg_e = v['total_edge'] / v['count'] * 100
        print(f"    {m:<14} {v['count']:>4} edges | avg: {avg_e:>+5.1f}% | elite: {v['elite']}")
    
    # ROI
    print(f"\n  PROFIT PROJECTION (1 unit flat stake):")
    if edges:
        total_roi = sum(e['model_prob'] * e['book_odds'] for e in edges) / len(edges) * 100 - 100
        print(f"    All edges ({len(edges)}): Expected ROI: {total_roi:>+.1f}%")
    if elite:
        elite_roi = sum(e['model_prob'] * e['book_odds'] for e in elite) / len(elite) * 100 - 100
        print(f"    ELITE only ({len(elite)}): Expected ROI: {elite_roi:>+.1f}%")
    if high:
        high_roi = sum(e['model_prob'] * e['book_odds'] for e in high) / len(high) * 100 - 100
        print(f"    HIGH only ({len(high)}): Expected ROI: {high_roi:>+.1f}%")
    
    # Save
    out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'value-analysis-v2.json')
    with open(out_path, 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'fixtures_analyzed': predictions_stored,
            'total_edges': len(edges),
            'elite': len(elite), 'high': len(high), 'value': len(value), 'minor': len(minor),
            'top_edges': [{k: float(v) if isinstance(v, (np.floating, float)) else v for k, v in e.items()} for e in edges[:50]],
            'by_market': {m: {'count': v['count'], 'avg_edge': v['total_edge']/max(v['count'],1), 'elite': v['elite']} for m, v in by_market.items()},
        }, f, indent=2)
    print(f"\n  Saved to data/value-analysis-v2.json")
    print(f"\n{'═' * 65}")

if __name__ == '__main__':
    main()
