#!/usr/bin/env bash
# 下載「找服務」語意比對用的向量模型到 assets/models/（不進 git，見 .gitignore）。
# 模型：EmbeddingGemma 2 Text 270M（litert-community，Apache-2.0，公開、不需 Hugging Face token）
# 固定修訂版並驗證 SHA-256；與 flutter_edge_ai_litertlm 1.19.1 的 LiteRtEmbedders 目錄一致。
# 用法：bash tool/semantic_search/fetch_model.sh
set -euo pipefail

REPO="litert-community/embeddinggemma-2-text-270m-litert-lm"
REV="9be6e8b90982095dc05c2bd162e4b954ee4dbac7"
FILE="embeddinggemma-2-text-270m.litertlm"
SHA256="2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb"
SIZE=164626432

DEST_DIR="$(cd "$(dirname "$0")/../.." && pwd)/assets/models"
DEST="$DEST_DIR/$FILE"
mkdir -p "$DEST_DIR"

verify() { [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$SHA256" ]; }

if [ -f "$DEST" ] && verify "$DEST"; then
  echo "已存在且驗證通過：$DEST"
  exit 0
fi

echo "下載 ${FILE}（約 $((SIZE / 1024 / 1024)) MB）…"
curl -fL --retry 3 -o "$DEST.part" "https://huggingface.co/$REPO/resolve/$REV/$FILE"
if ! verify "$DEST.part"; then
  rm -f "$DEST.part"
  echo "SHA-256 不符，已刪除下載檔。請勿改用其他來源。" >&2
  exit 1
fi
mv "$DEST.part" "$DEST"
echo "完成：$DEST"
