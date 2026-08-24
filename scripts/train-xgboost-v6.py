#!/usr/bin/env python3
"""ODDLY XGBoost v6.0 - Uses supabase-py client (proven working)"""
import json, os, sys, time
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
from sklearn.calibration import calibration_curve
from scipy.optimize import minimize
import warnings
warnings.filterwarnings('ignore')

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent.parent / "models"
RESULTS_DIR = DATA_DIR / "xgboost-results"
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)

def get_sb():
    from supabase import create_client
    env = {}
    for line in (Path(__file__).parent.parent / ".env.local").read_text().split("\n"):
        t = line.strip()
        if not t or t.startswith("#"): continue
        i = t.find("=")
        if i == -1: continue
        env[t[:i].strip()] = t[i+1:].strip().strip('"')
    return create_client(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

def paginated(sb, table, select, filters=None, limit=1000):
    """Load all rows using supabase-py pagination."""
    all_data = []
    off = 0
    while True:
        q = sb.table(table).select(select).order("created_at").range(off, off+limit-1)
        for k, v in (filters or {}).items():
            q = q.eq(k, v) if v.startswith("eq.") else q.neq(k, v.replace("neq.",""))
        r = q.execute()
        if not r.data: break
        all_data.extend(r.data)
        off += len(r.data)
        if len(r.data) < limit: break
    return all_data

def load_data(quick=False):
    sb = get_sb()
    ml = 5000 if quick else 500000

    print("Loading 1X2 predictions...")
    t0 = time.time()
    preds = []
    off = 0
    while len(preds) < ml:
        r = sb.table("predictions").select("id,fixture_id,market,selection,model_probability,confidence_tier,model_version,result,created_at,settled_at").neq("result","pending").eq("market","1X2").order("created_at").range(off, off+999).execute()
        if not r.data: break
        preds.extend(r.data)
        off += len(r.data)
        if len(r.data) < 1000: break
    print(f"  {len(preds)} 1X2 predictions in {time.time()-t0:.0f}s")

    print("Loading fixtures...")
    fixts = {}
    off = 0
    while True:
        r = sb.table("fixtures").select("id,home_team_id,away_team_id,league_id,kickoff_time,status,home_score,away_score").range(off, off+999).execute()
        if not r.data: break
        for f in r.data: fixts[f["id"]] = f
        off += len(r.data)
        if len(r.data) < 1000: break
    print(f"  {len(fixts)} fixtures")

    teams = {}
    for t in sb.table("teams").select("id,canonical_name").range(0, 999).execute().data:
        teams[t["id"]] = t["canonical_name"]
    print(f"  {len(teams)} teams")

    leagues = {}
    for l in sb.table("leagues").select("id,name").range(0, 999).execute().data:
        leagues[l["id"]] = l["name"]
    print(f"  {len(leagues)} leagues")

    odds = {}
    off = 0
    while True:
        r = sb.table("odds_snapshots").select("fixture_id,selection,odds").range(off, off+999).execute()
        if not r.data: break
        for o in r.data:
            fid = o["fixture_id"]
            if fid not in odds: odds[fid] = {}
            sel = o["selection"]
            if sel not in odds[fid]: odds[fid][sel] = []
            odds[fid][sel].append(o["odds"])
        off += len(r.data)
        if len(r.data) < 1000: break
    print(f"  {len(odds)} odds fixtures")

    return preds, fixts, teams, leagues, odds

def load_aux():
    xg = {}
    for name, key in [("statsbomb-xg.json","statsbomb"),("understat-xg.json","understat")]:
        p = DATA_DIR / name
        if p.exists():
            try:
                d = json.loads(p.read_text())
                xg[key] = d.get("features", d.get("teams", {}))
                print(f"  {key}: {len(xg[key])} teams")
            except: pass
    inj = {}
    p = DATA_DIR / "premier-injuries.json"
    if p.exists():
        try:
            for i in json.loads(p.read_text()).get("injuries", []):
                t = i.get("team_name","")
                if t not in inj: inj[t] = []
                inj[t].append(i)
        except: pass
    print(f"  Injuries: {len(inj)} teams")
    return xg, inj

class Tracker:
    def __init__(self):
        self.hist = {}; self.h2h = {}; self.elo = {}
    def feed(self, home, away, hg, ag):
        for t, gf, ga, isH in [(home,hg,ag,True),(away,ag,hg,False)]:
            if t not in self.hist: self.hist[t] = []
            self.hist[t].append({"gf":gf,"ga":ga,"home":isH})
            self.hist[t] = self.hist[t][-30:]
        k = f"{home}|{away}"
        if k not in self.h2h: self.h2h[k] = {"hw":0,"n":0}
        self.h2h[k]["n"] += 1
        if hg > ag: self.h2h[k]["hw"] += 1
        h = self.elo.get(home, 1500) + 65; a = self.elo.get(away, 1500)
        eH = 1/(1+10**((a-h)/400))
        actual = 1 if hg>ag else (0.5 if hg==ag else 0)
        self.elo[home] = self.elo.get(home, 1500) + 32*(actual-eH)
        self.elo[away] = self.elo.get(away, 1500) + 32*((1-actual)-(1-eH))
    def stats(self, team):
        h = self.hist.get(team, [])
        if len(h) < 3: return {"ppg":1.5,"gs":1.3,"gc":1.2,"wr":0.4,"cs":0.25,"hppg":1.6,"appg":1.1,"streak":0}
        r5=h[-5:]; r10=h[-10:]; hm=[m for m in h if m["home"]][-8:]; am=[m for m in h if not m["home"]][-8:]
        def ppg(m):
            if not m: return 1.4
            return np.mean([3 if x["gf"]>x["ga"] else (1 if x["gf"]==x["ga"] else 0) for x in m])
        streak = 0
        for m in reversed(h):
            w=m["gf"]>m["ga"]; l=m["gf"]<m["ga"]
            if streak>=0 and w: streak+=1
            elif streak<=0 and l: streak-=1
            else: break
        return {"ppg":ppg(r5),"gs":np.mean([m["gf"] for m in r5]),"gc":np.mean([m["ga"] for m in r5]),
                "wr":np.mean([1 if m["gf"]>m["ga"] else 0 for m in r5]),
                "cs":np.mean([1 if m["ga"]==0 else 0 for m in r10]),
                "hppg":ppg(hm),"appg":ppg(am),"streak":streak}
    def h2h_rate(self, home, away):
        d = self.h2h.get(f"{home}|{away}", {"hw":0,"n":0})
        return d["hw"]/d["n"] if d["n"]>0 else 0.46

def find_xg(name, xg_data):
    for src in ["statsbomb","understat"]:
        d = xg_data.get(src, {})
        if name in d: return d[name]
        for k, v in d.items():
            kn = k.split("_EPL_")[0].split("_La_liga_")[0].split("_Bundesliga_")[0].split("_Serie_A_")[0].split("_Ligue_1_")[0].split("_Eredivisie_")[0].split("_Primeira_Liga_")[0].split("_Championship_")[0]
            if kn.lower() == name.lower(): return v
    return None

def build_features(preds, fixts, teams, leagues, odds, xg, injuries):
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
        })
        if (i+1) % 5000 == 0: print(f"  {i+1}/{len(preds)}...")
    print(f"  {len(rows)} rows in {time.time()-t0:.0f}s")
    return pd.DataFrame(rows)

# Feature sets
B = ["elo_diff","home_ppg","away_ppg","ppg_diff","home_gs","home_gc","away_gs","away_gc","home_wr","away_wr","home_cs","away_cs","home_hppg","away_appg","hppg_diff","streak_diff","h2h_home"]
X = ["home_xg","away_xg","home_xga","away_xga","xg_diff","xga_diff","has_xg"]
I = ["home_inj","away_inj","inj_diff"]
O = ["home_odds","draw_odds","away_odds","home_implied","draw_implied","away_implied","has_odds"]
EXPS = {
    "A":("Baseline",["model_probability"]),
    "B":("Basic",B),
    "C":("Basic+xG",B+X),
    "D":("Basic+xG+Inj",B+X+I),
    "E":("Basic+xG+Odds",B+X+O),
    "F":("All XGB",B+X+I+O),
    "G":("All LGB",B+X+I+O),
}

def run_exp(name, features, tr, va, te, lgbm=False):
    avail = [f for f in features if f in tr.columns and f not in ["label","fixture_id","created_at","league_name"]]
    if not avail: return None, None
    Xtr=tr[avail].fillna(0).values; ytr=tr["label"].values
    Xva=va[avail].fillna(0).values; yva=va["label"].values
    Xte=te[avail].fillna(0).values; yte=te["label"].values
    t0=time.time()
    if lgbm:
        m=lgb.LGBMClassifier(n_estimators=500,learning_rate=0.05,max_depth=6,min_child_samples=20,subsample=0.8,colsample_bytree=0.8,reg_alpha=0.1,reg_lambda=0.1,random_state=42,verbose=-1)
        m.fit(Xtr,ytr,eval_set=[(Xva,yva)],callbacks=[lgb.early_stopping(50,verbose=False)])
    else:
        m=xgb.XGBClassifier(n_estimators=500,learning_rate=0.05,max_depth=6,min_child_weight=5,subsample=0.8,colsample_bytree=0.8,reg_alpha=0.1,reg_lambda=0.1,random_state=42,eval_metric="logloss",early_stopping_rounds=50,verbose=False)
        m.fit(Xtr,ytr,eval_set=[(Xva,yva)])
    dt=time.time()-t0
    p_tr=m.predict_proba(Xtr)[:,1]; p_va=m.predict_proba(Xva)[:,1]; p_te=m.predict_proba(Xte)[:,1]
    try:
        f,mp=calibration_curve(yte,p_te,n_bins=10); ce=float(np.mean(np.abs(f-mp)))
    except: ce=1.0
    tiers={}
    for tn,th in [("e70",0.70),("h60",0.60)]:
        mask=p_te>=th
        if mask.sum()>0: tiers[tn]={"n":int(mask.sum()),"acc":float(accuracy_score(yte[mask],(p_te[mask]>=0.5).astype(int))),"cov":float(mask.sum()/len(yte))}
    imp=dict(sorted(zip(avail,m.feature_importances_.tolist()),key=lambda x:-x[1])[:10]) if hasattr(m,"feature_importances_") else {}
    return {"name":name,"n":len(avail),"tr_sz":len(Xtr),"te_sz":len(Xte),"dt":round(dt,1),
            "tr_a":float(accuracy_score(ytr,(p_tr>=0.5).astype(int))),"tr_ll":float(log_loss(ytr,np.clip(p_tr,1e-7,1-1e-7))),
            "va_a":float(accuracy_score(yva,(p_va>=0.5).astype(int))),
            "te_a":float(accuracy_score(yte,(p_te>=0.5).astype(int))),"te_ll":float(log_loss(yte,np.clip(p_te,1e-7,1-1e-7))),
            "te_b":float(brier_score_loss(yte,p_te)),"ce":ce,"imp":imp,"tiers":tiers,
            "cal":[f.tolist(),mp.tolist()]}, m

def main():
    import argparse
    p=argparse.ArgumentParser(); p.add_argument("--quick",action="store_true"); a=p.parse_args()
    print("="*70+"\n  ODDLY XGBoost v6.0\n"+"="*70)
    preds,fixts,teams,leagues,odds=load_data(quick=a.quick)
    xg,inj=load_aux()
    df=build_features(preds,fixts,teams,leagues,odds,xg,inj)
    if len(df)<100: print("Not enough data"); return
    print(f"\nDataset: {len(df)} rows, {df['label'].mean():.1%} positive")
    df_s=df.sort_values("created_at").reset_index(drop=True)
    n=len(df_s); te=int(n*.6); ve=int(n*.8)
    tr_=df_s.iloc[:te]; va=df_s.iloc[te:ve]; te_=df_s.iloc[ve:]
    print(f"Train:{len(tr_)} Val:{len(va)} Test:{len(te_)}")
    res=[]; ms={}
    for en,(lab,feats) in EXPS.items():
        print(f"\n--- {en}: {lab} ({len(feats)}f) ---")
        r,m=run_exp(en,feats,tr_,va,te_,lgbm=(en=="G"))
        if r:
            res.append(r); ms[en]=m
            print(f"  Tr:{r['tr_a']:.1%} Va:{r['va_a']:.1%} Te:{r['te_a']:.1%} LL:{r['te_ll']:.4f} B:{r['te_b']:.4f} Cal:{r['ce']:.4f}")
            for tn,td in r.get("tiers",{}).items(): print(f"  {tn}:{td['n']}s {td['acc']:.1%} {td['cov']:.1%}")
            print(f"  Top:{list(r['imp'].keys())[:5]}")
    if len(ms)>=2:
        print("\n--- Ensemble ---")
        yte=te_["label"].values; mp=[]; en=[]
        for e,m in ms.items():
            av=[f for f in EXPS[e][1] if f in te_.columns and f not in ["label","fixture_id","created_at","league_name"]]
            if av: mp.append(m.predict_proba(te_[av].fillna(0).values)[:,1]); en.append(e)
        if len(mp)>=2:
            def ens_obj(w):
                w2=np.abs(w)/np.sum(np.abs(w))
                c=sum(w2[i]*mp[i] for i in range(len(mp)))
                return log_loss(yte,np.clip(c,1e-7,1-1e-7))
            r=minimize(ens_obj,np.ones(len(mp))/len(mp),method="Nelder-Mead")
            w=np.abs(r.x)/np.sum(np.abs(r.x))
            ens=sum(w[i]*mp[i] for i in range(len(mp)))
            print(f"  W:{dict(zip(en,[f'{x:.3f}' for x in w]))}")
            print(f"  Te:{accuracy_score(yte,(ens>=0.5).astype(int)):.1%} LL:{log_loss(yte,np.clip(ens,1e-7,1-1e-7)):.4f} B:{brier_score_loss(yte,ens):.4f}")
    if res:
        best=max(res,key=lambda x:x["te_a"])
        print(f"\n--- Errors ({best['name']}) ---")
        bm=ms.get(best["name"])
        if bm:
            Xte=te_[best["features"]].fillna(0).values; p=bm.predict_proba(Xte)[:,1]; pr=(p>=0.5).astype(int)
            e=te_.copy(); e["ok"]=(pr==te_["label"].values).astype(int); e["p"]=p
            if "league_name" in e.columns:
                la=e.groupby("league_name").agg(c=("ok","count"),a=("ok","mean")).sort_values("c",ascending=False).head(10)
                print("  League:"); [print(f"    {i:30s}:{r['a']:.1%} ({int(r['c'])})") for i,r in la.iterrows()]
            e["cb"]=pd.cut(e["p"],bins=[0,.5,.55,.6,.65,.7,.75,.8,.85,.9,1])
            ca=e.groupby("cb",observed=True).agg(c=("ok","count"),a=("ok","mean"),m=("p","mean"))
            print("  Confidence:"); [print(f"    {str(i):20s}:{r['a']:.1%} ({int(r['c'])} avg={r['m']:.3f})") for i,r in ca.iterrows()]
    print(f"\n{'='*70}\n  SUMMARY\n{'='*70}")
    print(f"{'E':>4s} {'F':>3s} {'Tr':>6s} {'Va':>6s} {'Te':>6s} {'B':>6s} {'Cal':>6s}")
    print("-"*50)
    for r in res: print(f"{r['name']:>4s} {r['n']:>3d} {r['tr_a']:>5.1%} {r['va_a']:>5.1%} {r['te_a']:>5.1%} {r['te_b']:>6.4f} {r['ce']:>6.4f}")
    print("-"*50)
    ts=datetime.now().strftime('%Y%m%d-%H%M')
    (RESULTS_DIR/f"xgb-v6-{ts}.json").write_text(json.dumps({"ts":datetime.now().isoformat(),"n":len(df),"res":res},indent=2,default=str))
    if res:
        best=max(res,key=lambda x:x["te_a"]); bm=ms.get(best["name"])
        if bm:
            bm.save_model(str(MODEL_DIR/"xgboost_v6_best.json"))
            (MODEL_DIR/"xgboost_v6_meta.json").write_text(json.dumps({"v":"v6","e":best["name"],"f":best["features"],"a":best["te_a"],"ts":datetime.now().isoformat()},indent=2))
            print(f"\nSaved: {best['name']} ({best['te_a']:.1%})")

if __name__=="__main__": main()
