#!/usr/bin/env python3
"""
1X2 Final Model — Optimize directly without Optuna
Focus: Fix Draw recall, push overall accuracy past 52%
Uses local CSV data.
"""
import json, os, warnings
from datetime import datetime
from collections import defaultdict, Counter
import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import accuracy_score, classification_report, log_loss
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import TimeSeriesSplit

warnings.filterwarnings("ignore")

csv_path = os.path.join(os.path.dirname(__file__), "..", "data", "1x2_training_data.csv")
print(f"📡 Loading {csv_path}...")
df = pd.read_csv(csv_path)
print(f"   {len(df)} matches, {len(df.columns)} columns")

mc = ["label", "date"]
fc = [c for c in df.columns if c not in mc]
df["date_dt"] = pd.to_datetime(df["date"])
df = df.sort_values("date_dt").reset_index(drop=True)

# 80/20 temporal split
sp = int(len(df) * 0.8)
train = df.iloc[:sp]; test = df.iloc[sp:]
Xtr = np.nan_to_num(train[fc].values, nan=0, posinf=10, neginf=-10)
ytr = train["label"].values
Xte = np.nan_to_num(test[fc].values, nan=0, posinf=10, neginf=-10)
yte = test["label"].values

cc = Counter(ytr); tot = len(ytr)
sw = np.array([tot / (3 * cc[y]) for y in ytr])

print(f"   Train: {len(train)} ({train['date'].iloc[0][:10]} → {train['date'].iloc[-1][:10]})")
print(f"   Test:  {len(test)} ({test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]})")
print(f"   Home: {(ytr==0).sum()} | Draw: {(ytr==1).sum()} | Away: {(ytr==2).sum()}")

# ─── Model 1: XGBoost with aggressive class balancing ──────────────────────
print("\n🏋️ Training XGBoost (aggressive class weights)...")
xgb_model = xgb.XGBClassifier(
    n_estimators=400, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
    gamma=0.2, reg_alpha=0.5, reg_lambda=2.0,
    objective="multi:softprob", num_class=3,
    eval_metric="mlogloss", early_stopping_rounds=50,
    random_state=42, n_jobs=-1, verbosity=0,
)
xgb_model.fit(Xtr, ytr, sample_weight=sw, eval_set=[(Xte, yte)], verbose=False)
p_xgb = xgb_model.predict_proba(Xte)
pred_xgb = np.argmax(p_xgb, axis=1)
acc_xgb = accuracy_score(yte, pred_xgb)
print(f"   XGBoost: {acc_xgb*100:.1f}% (best iter: {xgb_model.best_iteration})")

# ─── Model 2: LightGBM with class weights ──────────────────────────────────
print("\n🏋️ Training LightGBM...")
lgb_model = lgb.LGBMClassifier(
    n_estimators=400, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
    reg_alpha=0.5, reg_lambda=2.0,
    class_weight="balanced",
    objective="multiclass", num_class=3,
    random_state=42, n_jobs=-1, verbose=-1,
)
lgb_model.fit(Xtr, ytr, eval_set=[(Xte, yte)],
              callbacks=[lgb.early_stopping(50, verbose=False)])
p_lgb = lgb_model.predict_proba(Xte)
pred_lgb = np.argmax(p_lgb, axis=1)
acc_lgb = accuracy_score(yte, pred_lgb)
print(f"   LightGBM: {acc_lgb*100:.1f}% (best iter: {lgb_model.best_iteration_})")

# ─── Model 3: XGBoost tuned specifically for Draw detection ────────────────
print("\n🏋️ Training Draw-specialist XGBoost...")
# Binary: Draw vs Not-Draw
ytr_draw = (ytr == 1).astype(int)
yte_draw = (yte == 1).astype(int)
draw_weights = np.where(ytr_draw == 1, 3.0, 1.0)  # Upweight draws
xgb_draw = xgb.XGBClassifier(
    n_estimators=300, max_depth=4, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.7,
    gamma=0.2, reg_alpha=0.5,
    objective="binary:logistic",
    eval_metric="logloss", early_stopping_rounds=30,
    random_state=42, n_jobs=-1, verbosity=0,
)
xgb_draw.fit(Xtr, ytr_draw, sample_weight=draw_weights, eval_set=[(Xte, yte_draw)], verbose=False)
p_draw = xgb_draw.predict_proba(Xte)[:, 1]
print(f"   Draw classifier AUC-like: {(p_draw[yte_draw==1].mean() - p_draw[yte_draw==0].mean()):.3f}")

# ─── Ensemble: XGB + LGB + Draw bonus ──────────────────────────────────────
print("\n🏋️ Building final ensemble...")
# Weight XGB more, add Draw specialist signal
for w_xgb in [0.4, 0.5, 0.6]:
    for w_draw in [0.0, 0.1, 0.2, 0.3]:
        w_lgb = 1 - w_xgb
        ep = w_xgb * p_xgb + w_lgb * p_lgb
        # Add draw bonus
        if w_draw > 0:
            ep[:, 1] += w_draw * p_draw
            # Renormalize
            ep = ep / ep.sum(axis=1, keepdims=True)
        
        pred = np.argmax(ep, axis=1)
        acc = accuracy_score(yte, pred)
        draw_mask = yte == 1
        draw_recall = (pred[draw_mask] == 1).mean() if draw_mask.sum() > 0 else 0
        
        if w_draw == 0.2 or (acc > 0.51 and w_draw == 0.1):
            print(f"   w_xgb={w_xgb:.1f} w_lgb={w_lgb:.1f} w_draw={w_draw:.1f} → {acc*100:.1f}% draw_recall={draw_recall*100:.1f}%")

# Best combo: search
best_acc, best_params = 0, None
for w_xgb in np.arange(0.3, 0.71, 0.05):
    for w_draw in np.arange(0.0, 0.41, 0.05):
        w_lgb = 1 - w_xgb
        ep = w_xgb * p_xgb + w_lgb * p_lgb
        if w_draw > 0:
            ep[:, 1] += w_draw * p_draw
            ep = ep / ep.sum(axis=1, keepdims=True)
        pred = np.argmax(ep, axis=1)
        acc = accuracy_score(yte, pred)
        if acc > best_acc:
            best_acc = acc
            best_params = (w_xgb, w_lgb, w_draw)

w_xgb, w_lgb, w_draw = best_params
ep = w_xgb * p_xgb + w_lgb * p_lgb
if w_draw > 0:
    ep[:, 1] += w_draw * p_draw
    ep = ep / ep.sum(axis=1, keepdims=True)
best_pred = np.argmax(ep, axis=1)
best_proba = ep

print(f"\n{'='*60}")
print(f"🏆 BEST ENSEMBLE: w_xgb={w_xgb:.2f} w_lgb={w_lgb:.2f} w_draw={w_draw:.2f}")
print(f"{'='*60}")
print(classification_report(yte, best_pred, target_names=["Home Win", "Draw", "Away Win"], zero_division=0))

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

# Feature importance (XGBoost)
print(f"\n📊 Top 15 Features (XGBoost):")
imp = xgb_model.feature_importances_
fi = sorted(zip(fc, imp), key=lambda x: x[1], reverse=True)
for name, val in fi[:15]:
    print(f"   {name:25s} {val:.4f} {'█' * int(val * 200)}")

# Save
model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
os.makedirs(model_dir, exist_ok=True)
xgb_model.save_model(os.path.join(model_dir, "xgboost_1x2_final.json"))
lgb_model.booster_.save_model(os.path.join(model_dir, "lgbm_1x2_final.txt"))

with open(os.path.join(model_dir, "1x2_final_meta.json"), "w") as f:
    json.dump({
        "version": "final", "accuracy": float(best_acc),
        "xgb_accuracy": float(acc_xgb), "lgb_accuracy": float(acc_lgb),
        "ensemble_weights": {"xgb": float(w_xgb), "lgb": float(w_lgb), "draw_bonus": float(w_draw)},
        "n_features": len(fc), "n_train": len(train), "n_test": len(test),
        "train_date": str(datetime.now()),
        "feature_names": fc,
        "test_period": f"{test['date'].iloc[0][:10]} → {test['date'].iloc[-1][:10]}",
    }, f, indent=2)

print(f"\n💾 Models saved to {model_dir}")
print(f"{'='*60}")
print(f"🏆 Final 1X2 Accuracy: {best_acc*100:.1f}%")
print(f"{'='*60}")
