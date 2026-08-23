#!/usr/bin/env python3
"""Export 1X2 training data to local CSV for offline model training."""
import json, os, sys, time
from collections import defaultdict
import numpy as np
import pandas as pd
from supabase import create_client

ENV = {}
with open(os.path.join(os.path.dirname(__file__), "..", ".env.local")) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"): continue
        idx = line.index("=")
        ENV[line[:idx].strip()] = line[idx+1:].strip().strip('"').strip("'")

sb = create_client(ENV["NEXT_PUBLIC_SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"])

def load_fixtures():
    fixtures = []
    offset = 0
    while True:
        for attempt in range(3):
            try:
                r = sb.table("fixtures").select(
                    "id, home_team_id, away_team_id, league_id, kickoff_time, status, home_score, away_score"
                ).eq("status", "finished").not_.is_("home_score", "null").order(
                    "kickoff_time", desc=False
                ).range(offset, offset + 500 - 1).execute()
                break
            except Exception as e:
                print(f"   Retry {attempt+1}/3: {e}")
                time.sleep(5)
        else:
            print(f"   Failed at offset {offset}, stopping")
            break
        batch = r.data
        if not batch: break
        fixtures.extend(batch)
        offset += len(batch)
        if len(batch) < 500: break
    return fixtures

print("📡 Loading fixtures...")
fixtures = load_fixtures()
print(f"   {len(fixtures)} matches")

# Feature engine (simplified)
class FE:
    def __init__(self):
        self.IE=1500; self.K=20
        self.tm=defaultdict(list); self.te={}; self.h2h=defaultdict(list)
        self.ls=defaultdict(lambda:{"hw":0,"d":0,"aw":0,"n":0,"goals":[]})
    def elo_e(self,a,b): return 1/(1+10**((b-a)/400))
    def elo_u(self,ea,eb,sa):
        na=ea+self.K*(sa-self.elo_e(ea,eb)); nb=eb+self.K*((1-sa)-self.elo_e(eb,ea))
        return na,nb
    def form(self,tid,n=15):
        ms=self.tm.get(tid,[])[:n]
        if not ms: return [0]*10
        pts,gf,ga,w,d,l_,hn,cs,l3=0,0,0,0,0,0,0,0,0
        for i,m in enumerate(ms):
            ih=m[1]==tid; h,a_=int(m[3]),int(m[4])
            g,h_=(a_ if ih else h),(h if ih else a_)
            gf+=g;ga+=h_
            if ih:hn+=1
            if g==0:cs+=1
            if g>h_:w+=1;pts+=3
            elif g==h_:d+=1;pts+=1
            else:l_+=1
            if i>=n-3:
                if g>h_:l3+=3
                elif g==h_:l3+=1
        nn=max(len(ms),1)
        return[pts/nn,gf/nn,ga/nn,w/nn,d/nn,l_/nn,hn/nn,cs/nn,l3/3,0]
    def h2h_f(self,a,b):
        k=tuple(sorted([a,b])); ms=self.h2h.get(k,[])[:10]
        if not ms: return [0]*5
        aw,bw,dr,tg,ag=0,0,0,0,0
        for m in ms:
            h,a_=int(m[0]),int(m[1]); ht=m[3]; tg+=h+a_
            if ht==a:
                ag+=h
                if h>a_:aw+=1
                elif h<a_:bw+=1
                else:dr+=1
            else:
                ag+=a_
                if a_>h:aw+=1
                elif a_<h:bw+=1
                else:dr+=1
        nn=max(len(ms),1)
        return[aw/nn,bw/nn,dr/nn,tg/nn,ag/nn]
    def lf(self,lid):
        ls=self.ls[lid]; t=max(ls["n"],1); ag=np.mean(ls["goals"]) if ls["goals"] else 2.6
        return[ls["hw"]/t,ls["d"]/t,ls["aw"]/t,ag,np.log1p(t)]
    def sf(self,tid):
        ms=self.tm.get(tid,[])[:20]
        if not ms: return[1.3]*9
        att=np.mean([int(m[3]) if m[1]==tid else int(m[4]) for m in ms])
        deff=np.mean([int(m[4]) if m[1]==tid else int(m[3]) for m in ms])
        ht=[m for m in ms if m[1]==tid]; aw=[m for m in ms if m[2]==tid]
        hta=np.mean([int(m[3]) for m in ht]) if ht else att
        htd=np.mean([int(m[4]) for m in ht]) if ht else deff
        awa=np.mean([int(m[4]) for m in aw]) if aw else att
        at=np.mean([int(m[3])+int(m[4]) for m in ms])
        return[att,deff,hta,htd,awa,at,len(ht)/max(len(ms),1),len(aw)/max(len(ms),1),len(ms)]
    def build(self,fx):
        h,a,l=fx["home_team_id"],fx["away_team_id"],fx["league_id"];f={}
        hf_=self.form(h);af_=self.form(a)
        for i in range(10):f[f"hf{i}"]=hf_[i];f[f"af{i}"]=af_[i];f[f"fd{i}"]=hf_[i]-af_[i]
        he=self.te.get(h,self.IE);ae=self.te.get(a,self.IE)
        f["he"]=he;f["ae"]=ae;f["ed"]=he-ae;f["ee"]=self.elo_e(he,ae)
        h2=self.h2h_f(h,a)
        for i,v in enumerate(h2):f[f"h{i}"]=v
        for i,v in enumerate(self.lf(l)):f[f"l{i}"]=v
        hs_=self.sf(h);as_=self.sf(a)
        for i in range(9):f[f"hs{i}"]=hs_[i];f[f"as{i}"]=as_[i]
        f["ad"]=hs_[0]-as_[0];f["dd"]=hs_[1]-as_[1];f["axd"]=f["ad"]*f["dd"]
        f["sd"]=(hs_[0]/max(hs_[1],.1))-(as_[0]/max(as_[1],.1))
        return f
    def update(self,fx):
        h,a,l=fx["home_team_id"],fx["away_team_id"],fx["league_id"]
        hs_,as_=int(fx["home_score"]),int(fx["away_score"]);dt=fx["kickoff_time"]
        self.tm[h].append((dt,h,a,hs_,as_,l))
        self.tm[a].append((dt,h,a,hs_,as_,l))
        k=tuple(sorted([h,a]));self.h2h[k].append((hs_,as_,dt,h,a))
        he=self.te.get(h,self.IE);ae=self.te.get(a,self.IE)
        s=1.0 if hs_>as_ else(0.5 if hs_==as_ else 0.0)
        self.te[h],self.te[a]=self.elo_u(he,ae,s)
        ls=self.ls[l];ls["n"]+=1;ls["goals"].append(hs_+as_)
        if hs_>as_:ls["hw"]+=1
        elif hs_==as_:ls["d"]+=1
        else:ls["aw"]+=1

print("🔧 Building features...")
fe=FE(); recs=[]
for i,fx in enumerate(fixtures):
    if i%2000==0: print(f"   {i}/{len(fixtures)}...")
    feat=fe.build(fx);hs_,as_=int(fx["home_score"]),int(fx["away_score"])
    feat["label"]=0 if hs_>as_ else(1 if hs_==as_ else 2)
    feat["date"]=fx["kickoff_time"];recs.append(feat);fe.update(fx)

df=pd.DataFrame(recs)
csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "1x2_training_data.csv")
df.to_csv(csv_path, index=False)
print(f"✅ Saved {len(df)} rows to {csv_path}")
print(f"   Columns: {len(df.columns)}")
print(f"   Features: {len([c for c in df.columns if c not in ['label','date']])}")
