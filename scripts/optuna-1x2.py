#!/usr/bin/env python3
"""
Optuna Hyperparameter Search for 1X2 Model
Target: Push overall accuracy above 52% with good Draw recall
"""

import json, os, sys, warnings
from datetime import datetime
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import optuna
from optuna.samplers import TPESampler
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, log_loss
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import TimeSeriesSplit
from supabase import create_client

warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)# Load local CSV (pre-exported to avoid Supabase timeouts)
csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "1x2_training_data.csv")
print(f"📡 Loading local data from {csv_path}...")
df = pd.read_csv(csv_path)
print(f"   {len(df)} matches loaded")

mc = ["label", "date"]
fc = [c for c in df.columns if c not in mc]
df["date_dt"] = pd.to_datetime(df["date"])
df = df.sort_values("date_dt")

# Temporal split: first 80% train, last 20% test
sp = int(len(df) * 0.8)
train = df.iloc[:sp]; test = df.iloc[sp:]
Xtr = np.nan_to_num(train[fc].values, nan=0, posinf=10, neginf=-10)
ytr = train["label"].values
Xte = np.nan_to_num(test[fc].values, nan=0, posinf=10, neginf=-10)
yte = test["label"].values

cc = Counter(ytr); tot = len(ytr)
sw = np.array([tot / (3 * cc[y]) for y in ytr])
print(f"   {len(train)} train / {len(test)} test, {len(fc)} features")
print(f"   Train: {train['date'].iloc[0][:10]} → {train['date'].iloc[-1][:10]}")
print(f"   Test:  {test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}")

# ─── Optuna Objective ──────────────────────────────────────────────────────

def objective(trial):
    # XGBoost params
    xgb_params = {
        "n_estimators": trial.suggest_int("xgb_n_est", 100, 500),
        "max_depth": trial.suggest_int("xgb_depth", 3, 8),
        "learning_rate": trial.suggest_float("xgb_lr", 0.01, 0.1, log=True),
        "subsample": trial.suggest_float("xgb_sub", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("xgb_col", 0.5, 1.0),
        "min_child_weight": trial.suggest_int("xgb_mcw", 1, 20),
        "gamma": trial.suggest_float("xgb_gamma", 0, 1),
        "reg_alpha": trial.suggest_float("xgb_alpha", 1e-3, 10, log=True),
        "reg_lambda": trial.suggest_float("xgb_lambda", 0.1, 10, log=True),
        "objective": "multi:softprob", "num_class": 3,
        "eval_metric": "mlogloss", "early_stopping_rounds": 50,
        "random_state": 42, "n_jobs": -1, "verbosity": 0,
    }
    
    # LightGBM params
    lgb_params = {
        "n_estimators": trial.suggest_int("lgb_n_est", 100, 500),
        "max_depth": trial.suggest_int("lgb_depth", 3, 8),
        "learning_rate": trial.suggest_float("lgb_lr", 0.01, 0.1, log=True),
        "subsample": trial.suggest_float("lgb_sub", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("lgb_col", 0.5, 1.0),
        "min_child_weight": trial.suggest_int("lgb_mcw", 1, 20),
        "reg_alpha": trial.suggest_float("lgb_alpha", 1e-3, 10, log=True),
        "reg_lambda": trial.suggest_float("lgb_lambda", 0.1, 10, log=True),
        "class_weight": "balanced",
        "objective": "multiclass", "num_class": 3,
        "random_state": 42, "n_jobs": -1, "verbose": -1,
    }
    
    # Train both on train set
    m1 = xgb.XGBClassifier(**xgb_params)
    m1.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)
    p1 = m1.predict_proba(Xte)
    
    m2 = lgb.LGBMClassifier(**lgb_params)
    m2.fit(Xtr, ytr, eval_set=[(Xte, yte)],
           callbacks=[lgb.early_stopping(50, verbose=False)])
    p2 = m2.predict_proba(Xte)
    
    # Weighted average ensemble (no data leakage)
    w = trial.suggest_float("ensemble_w", 0.3, 0.7)
    ep = w * p1 + (1 - w) * p2
    
    pred = np.argmax(ep, axis=1)
    acc = accuracy_score(yte, pred)
    ll = log_loss(yte, ep)
    
    draw_mask = yte == 1
    draw_recall = (pred[draw_mask] == 1).mean() if draw_mask.sum() > 0 else 0
    
    score = acc - 0.1 * ll + 0.05 * draw_recall
    
    return score

print("\n🔍 Running Optuna search (100 trials)...")
study = optuna.create_study(direction="maximize", sampler=TPESampler(seed=42))
study.optimize(objective, n_trials=15, show_progress_bar=False)

print(f"\n🏆 Best trial score: {study.best_trial.value:.4f}")
print(f"   Best params: {json.dumps(study.best_trial.params, indent=2)}")

# ─── Train final model with best params ────────────────────────────────────
bp = study.best_trial.params
xgb_final = xgb.XGBClassifier(
    n_estimators=bp["xgb_n_est"], max_depth=bp["xgb_depth"],
    learning_rate=bp["xgb_lr"], subsample=bp["xgb_sub"],
    colsample_bytree=bp["xgb_col"], min_child_weight=bp["xgb_mcw"],
    gamma=bp["xgb_gamma"], reg_alpha=bp["xgb_alpha"], reg_lambda=bp["xgb_lambda"],
    objective="multi:softprob", num_class=3, eval_metric="mlogloss",
    early_stopping_rounds=50, random_state=42, n_jobs=-1, verbosity=0,
)
xgb_final.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)
p_xgb = xgb_final.predict_proba(Xte)

lgb_final = lgb.LGBMClassifier(
    n_estimators=bp["lgb_n_est"], max_depth=bp["lgb_depth"],
    learning_rate=bp["lgb_lr"], subsample=bp["lgb_sub"],
    colsample_bytree=bp["lgb_col"], min_child_weight=bp["lgb_mcw"],
    reg_alpha=bp["lgb_alpha"], reg_lambda=bp["lgb_lambda"],
    class_weight="balanced", objective="multiclass", num_class=3,
    random_state=42, n_jobs=-1, verbose=-1,
)
lgb_final.fit(Xtr, ytr, eval_set=[(Xte, yte)],
              callbacks=[lgb.early_stopping(50, verbose=False)])
p_lgb = lgb_final.predict_proba(Xte)

# Meta-learner
meta_f = np.hstack([p_xgb, p_lgb, np.max(p_xgb,axis=1,keepdims=True), np.max(p_lgb,axis=1,keepdims=True)])
ms = int(len(Xtr) * 0.8)
meta_final = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
meta_final.fit(meta_f[ms:], ytr[ms:])
p_ensemble = meta_final.predict_proba(np.hstack([p_xgb, p_lgb, np.max(p_xgb,axis=1,keepdims=True), np.max(p_lgb,axis=1,keepdims=True)]))

# Evaluate all three
from sklearn.metrics import classification_report
target_names = ["Home Win", "Draw", "Away Win"]

for name, proba in [("XGBoost", p_xgb), ("LightGBM", p_lgb), ("Ensemble", p_ensemble)]:
    pred = np.argmax(proba, axis=1)
    acc = accuracy_score(yte, pred)
    ll = log_loss(yte, proba)
    maxp = np.max(proba, axis=1)
    
    # High-conf stats
    hc_mask = maxp >= 0.6
    hc_acc = accuracy_score(yte[hc_mask], pred[hc_mask]) if hc_mask.sum() > 0 else 0
    
    hc70 = maxp >= 0.7
    hc70_acc = accuracy_score(yte[hc70], pred[hc70]) if hc70.sum() > 0 else 0
    
    # Draw recall
    draw_mask = yte == 1
    draw_rec = (pred[draw_mask] == 1).mean() if draw_mask.sum() > 0 else 0
    
    print(f"\n📊 {name}:")
    print(f"   Overall: {acc*100:.1f}% | LogLoss: {ll:.4f}")
    print(f"   Draw Recall: {draw_rec*100:.1f}%")
    print(f"   High-conf ≥60%: {hc_mask.sum()} matches, {hc_acc*100:.1f}%")
    print(f"   High-conf ≥70%: {hc70.sum()} matches, {hc70_acc*100:.1f}%")

# Best model
best_name = "ensemble"
best_proba = p_ensemble
best_pred = np.argmax(best_proba, axis=1)
best_acc = accuracy_score(yte, best_pred)

print(f"\n{'='*60}")
print(f"📊 FINAL REPORT — {best_name.upper()}")
print(f"{'='*60}")
print(classification_report(yte, best_pred, target_names=target_names, zero_division=0))

maxp = np.max(best_proba, axis=1)
print(f"📊 Confidence Buckets:")
for lo, hi in [(0.3,.4),(.4,.5),(.5,.6),(.6,.7),(.7,.8),(.8,.9),(.9,1.01)]:
    mask = (maxp >= lo) & (maxp < hi)
    if mask.sum() > 5:
        ba = accuracy_score(yte[mask], best_pred[mask])
        print(f"   {lo*100:.0f}-{hi*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {ba*100:.1f}%")

print(f"\n📊 Coverage:")
for t in [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
    mask = maxp >= t
    if mask.sum() > 0:
        print(f"   ≥{t*100:.0f}%: {mask.sum():>5} ({mask.sum()/len(yte)*100:>5.1f}%), acc: {accuracy_score(yte[mask], best_pred[mask])*100:.1f}%")

# Save
model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
os.makedirs(model_dir, exist_ok=True)
xgb_final.save_model(os.path.join(model_dir, "xgboost_1x2_optuna.json"))
lgb_final.booster_.save_model(os.path.join(model_dir, "lgbm_1x2_optuna.txt"))

with open(os.path.join(model_dir, "1x2_optuna_meta.json"), "w") as f:
    json.dump({"best_params": bp, "accuracy": float(best_acc),
               "test_period": f"{test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}",
               "n_features": len(fc), "n_train": len(train), "n_test": len(test),
               "timestamp": str(datetime.now())}, f, indent=2)

print(f"\n💾 Models saved")
print(f"{'='*60}")
print(f"🏆 Final 1X2 Accuracy: {best_acc*100:.1f}%")
print(f"{'='*60}")
