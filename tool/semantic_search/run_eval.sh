#!/usr/bin/env bash
# 在已開啟的 Android 模擬器或接上的 arm64 手機上，用真模型量測 queries.json 與 queries_holdout.json，
# 然後存成 scores.json，再用 eval_merge.mjs 算命中率。
#
# 前置：已執行 tool/semantic_search/fetch_model.sh；有一台 arm64 的 Android 裝置（adb devices 看得到）。
# 用法：bash tool/semantic_search/run_eval.sh [裝置序號]
set -euo pipefail
cd "$(dirname "$0")/../.."

FLUTTER="${FLUTTER:-$HOME/fvm/versions/3.47.6/bin/flutter}"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
DEVICE="${1:-$($ADB devices | awk 'NR>1 && $2=="device" {print $1; exit}')}"
[ -n "$DEVICE" ] || { echo "找不到 Android 裝置" >&2; exit 1; }
[ -f assets/models/embeddinggemma-2-text-270m.litertlm ] || { echo "先執行 tool/semantic_search/fetch_model.sh" >&2; exit 1; }

WORK="$(mktemp -d)"
LOG="$WORK/logcat.txt"

# 兩份題目合併成一份壓縮 JSON，用 --dart-define 帶進 App（不需要把測試題打包成 asset）
QUERIES="$(node -e '
const r=(f)=>require(process.argv[1]+"/tool/semantic_search/"+f).queries.map(x=>({id:x.id,text:x.text}));
let q=r("queries.json"); try{q=q.concat(r("queries_holdout.json"))}catch(e){}
process.stdout.write(JSON.stringify(q));' "$PWD")"

echo "建置量測用 APK…"
"$FLUTTER" build apk --debug -t tool/semantic_search/eval_main.dart --dart-define="QUERIES_JSON=$QUERIES"

echo "安裝到 ${DEVICE}（會先移除舊的 com.example.townpass，等於第一次啟動）"
"$ADB" -s "$DEVICE" uninstall com.example.townpass >/dev/null 2>&1 || true
"$ADB" -s "$DEVICE" install -r build/app/outputs/flutter-apk/app-debug.apk
"$ADB" -s "$DEVICE" logcat -c
"$ADB" -s "$DEVICE" logcat -v raw -s flutter:V > "$LOG" 2>&1 &
LOGCAT_PID=$!
trap 'kill $LOGCAT_PID 2>/dev/null || true' EXIT
"$ADB" -s "$DEVICE" shell am start -n com.example.townpass/.MainActivity >/dev/null

echo "量測中…（模型複製、載入、建索引、逐題比對，通常 1～2 分鐘）"
for _ in $(seq 1 240); do
  grep -q "EVAL_DONE" "$LOG" 2>/dev/null && break
  sleep 2
done
grep -q "EVAL_DONE" "$LOG" || { echo "逾時，log 在 $LOG" >&2; exit 1; }

MODEL="$("$ADB" -s "$DEVICE" shell getprop ro.product.model | tr -d '\r')"
ABI="$("$ADB" -s "$DEVICE" shell getprop ro.product.cpu.abi | tr -d '\r')"
MEM="$("$ADB" -s "$DEVICE" shell "head -1 /proc/meminfo" | tr -s ' ' | tr -d '\r')"
node tool/semantic_search/collect_scores.mjs "$LOG" "Android $MODEL ($ABI, $MEM)"
node tool/semantic_search/eval_merge.mjs
