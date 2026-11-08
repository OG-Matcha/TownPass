#!/usr/bin/env bash
# 比賽期間每 10 分鐘存一份捷運無障礙異常公告快照（Demo 用真實歷史，不靠模擬）
OUT="$(dirname "$0")/../snapshots"
mkdir -p "$OUT"
while true; do
  ts=$(date +%Y%m%dT%H%M)
  curl -s --max-time 30 "https://data.taipei/api/v1/dataset/649c44eb-60b5-4746-a353-cbdc6651fc09?scope=resourceAquire&limit=1000" -o "$OUT/anomalies-$ts.json"
  sleep 600
done
