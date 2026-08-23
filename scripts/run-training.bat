@echo off
set PYTHONIOENCODING=utf-8
python scripts/train-xgboost.py > data\xgboost-training.log 2> data\xgboost-training.err
