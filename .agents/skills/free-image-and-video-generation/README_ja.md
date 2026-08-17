<div align="center">

# 🎨 無料 画像 & 動画 AI Agent スキル

**7つの無料ローカルAIツール + 300以上のクラウドAIモデル — すべてのAIエージェントに対応**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Python 3.10-3.12](https://img.shields.io/badge/Python-3.10--3.12-blue.svg)](https://python.org)
[![uv](https://img.shields.io/badge/uv-package%20manager-blueviolet)](https://docs.astral.sh/uv/)

[English](./README.md) · [中文](./README_zh.md) · [日本語](./README_ja.md) · [한국어](./README_ko.md)

</div>

<br>

### ✨ このスキルを選ぶ理由

- 🆓 **完全無料** — 7つのローカルAIツールがオフラインで動作、APIキー不要、使用制限なし
- ⚡ **ゼロセットアップ** — `uv run` だけで起動。依存関係は自動インストール
- 🔒 **プライバシー優先** — すべてのローカル処理はお使いのマシン上で完結
- 🌐 **300以上のクラウドモデル** — Flux、Seedream、Nano Banana、Kling、Wanなど300以上のモデルに1つのAPIでアクセス — **fal.aiや公式APIより最大88%お得**
- 🤖 **エージェント対応** — Claude Code、Cursor、Codex、Copilotなど15以上のAIエージェントですぐに使える
- 🔗 **本番ワークフロー** — ツールを連携：生成 → アップスケール → 背景除去 → 動画作成

> 🏆 **ゴールドスポンサー**: [Atlas Cloud](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill) — 300以上のAIモデル統合API。SOC I & II認証 · HIPAA準拠。fal.aiや公式APIより最大88%お得。

---

## 📦 インストール

### 前提条件

- 🐍 Python 3.10 - 3.12 — [python.org](https://python.org)（一部の依存関係が3.13未対応、`uv`が適切なバージョンを自動管理）
- 📦 uv — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- 🎬 FFmpeg — `brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`

### スキルをインストール

```bash
# ✅ 方法1: AIエージェントスキルとしてインストール（Claude Code、Cursor、Codex等）
npx skills add ristponex/free-image-and-video-generation-skill

# 📂 方法2: 直接クローン
git clone https://github.com/ristponex/free-image-and-video-generation-skill.git
cd free-image-and-video-generation-skill
```

### ☁️ クラウドAI設定（任意 — AI画像/動画生成用）

```bash
# https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill でAPIキーを取得
# （無料クレジット付き、クレジットカード不要）

# Mac / Linux — ~/.bashrc または ~/.zshrc に追加：
export ATLAS_CLOUD_API_KEY=your_key_here

# Windows (PowerShell)：
$env:ATLAS_CLOUD_API_KEY="your_key_here"
# Windows (永続設定 — 管理者として実行)：
setx ATLAS_CLOUD_API_KEY "your_key_here"

# またはプロジェクトディレクトリに .env ファイルを作成：
echo 'ATLAS_CLOUD_API_KEY=your_key_here' >> .env
```

---

## 🛠️ 含まれるもの

### 🆓 無料ローカルツール — APIキー不要、100%オフライン

| # | ツール | スクリプト | 技術基盤 | 機能 |
|---|--------|----------|---------|------|
| 1 | 🔍 **画像アップスケール** | `scripts/upscale.py` | Real-ESRGAN | 2x/4x AI超解像 |
| 2 | 👤 **顔補正** | `scripts/face-enhance.py` | Real-ESRGAN | ぼやけた写真・古い写真の修復 |
| 3 | ✂️ **背景除去** | `scripts/bg-remove.py` | rembg (U2-Net) | 背景除去 → 透過PNG |
| 4 | 🧹 **オブジェクト消去** | `scripts/erase.py` | LaMa Inpainting | 不要なオブジェクトを消去 |
| 5 | 🎭 **顔交換** | `scripts/face-swap.py` | InsightFace | 画像間での顔交換 |
| 6 | 🧩 **スマート分割** | `scripts/segment.py` | FastSAM | テキスト/ポイント/ボックスで分割 |
| 7 | 🎬 **メディア処理** | `scripts/media-process.py` | FFmpeg | 変換、圧縮、トリム、結合、GIF |

### ☁️ クラウドAI生成 — Atlas Cloud APIで300以上のモデル

| # | ツール | スクリプト | 機能 |
|---|--------|----------|------|
| 8 | 🎨 **AI生成** | `scripts/ai-generate.py` | 300以上のモデルで画像・動画を生成 |

**人気モデル**: Flux Schnell · Seedream v5.0 · Nano Banana 2 · Imagen4 Ultra · Wan 2.6 · Kling v3.0 · Seedance · Vidu · Hailuo など

```bash
# 📋 利用可能なモデルと価格を閲覧
uv run scripts/ai-generate.py models
```

---

## 📖 使い方

すべてのスクリプトは `uv run` を使用 — 依存関係は初回実行時に**自動インストール**。

<details>
<summary>🔍 <b>画像アップスケール</b> — 2x/4x AI超解像（無料）</summary>

```bash
uv run scripts/upscale.py input.jpg                   # 4xアップスケール（デフォルト）
uv run scripts/upscale.py input.jpg --scale 2          # 2xアップスケール
uv run scripts/upscale.py input.jpg --face-enhance     # 顔補正付き
uv run scripts/upscale.py ./photos/ --scale 4          # フォルダ一括処理
```
</details>

<details>
<summary>👤 <b>顔補正</b> — 古い写真の修復（無料）</summary>

```bash
uv run scripts/face-enhance.py old-photo.jpg                                  # デフォルト補正
uv run scripts/face-enhance.py old-photo.jpg --method codeformer --fidelity 0.7  # CodeFormer
uv run scripts/face-enhance.py old-photo.jpg --bg-upscale 2                   # 背景アップスケール付き
```
</details>

<details>
<summary>✂️ <b>背景除去</b> — 透過PNG出力（無料）</summary>

```bash
uv run scripts/bg-remove.py product.jpg                        # 背景除去
uv run scripts/bg-remove.py portrait.jpg --alpha-matting        # 精密エッジ（髪、毛皮）
uv run scripts/bg-remove.py character.png --model isnet-anime   # アニメ最適化
uv run scripts/bg-remove.py ./products/ -o ./transparent/       # 一括処理
```
</details>

<details>
<summary>🧹 <b>オブジェクト消去</b>（無料）</summary>

```bash
uv run scripts/erase.py photo.png --mask mask.png              # マスクで消去
uv run scripts/erase.py photo.png --region 100,200,150,150     # 座標で消去
```
</details>

<details>
<summary>🎭 <b>顔交換</b>（無料）</summary>

```bash
uv run scripts/face-swap.py --source face.jpg --target photo.jpg              # 基本交換
uv run scripts/face-swap.py --source face.jpg --target group.jpg --face-index 2  # 集合写真
```
</details>

<details>
<summary>🧩 <b>スマート分割</b>（無料）</summary>

```bash
uv run scripts/segment.py image.jpg --text "the dog"    # テキストプロンプト
uv run scripts/segment.py image.jpg --point 400,300     # ポイント指定
uv run scripts/segment.py image.jpg                     # すべて分割
```
</details>

<details>
<summary>🎬 <b>メディア処理</b>（無料）</summary>

```bash
uv run scripts/media-process.py convert video.mp4 output.webm          # 形式変換
uv run scripts/media-process.py compress video.mp4 --target-size 10    # 圧縮
uv run scripts/media-process.py gif video.mp4 --start 5 --duration 3   # GIF作成
uv run scripts/media-process.py trim video.mp4 --start 00:01:00 --end 00:02:30
uv run scripts/media-process.py merge clip1.mp4 clip2.mp4 -o combined.mp4
uv run scripts/media-process.py info video.mp4                         # メディア情報
```
</details>

<details>
<summary>🎨 <b>AI画像生成</b> — 300以上のクラウドモデル（Atlas Cloud）</summary>

```bash
uv run scripts/ai-generate.py models --type image

uv run scripts/ai-generate.py image "A cat astronaut on the moon" \
  --model black-forest-labs/flux-schnell --size 1024*1024

uv run scripts/ai-generate.py image "Anime character with blue hair" \
  --model google/nano-banana-2/text-to-image --aspect-ratio 1:1 --resolution 1k
```
</details>

<details>
<summary>🎥 <b>AI動画生成</b> — シネマグレード（Atlas Cloud）</summary>

```bash
uv run scripts/ai-generate.py models --type video

uv run scripts/ai-generate.py video "Cherry blossoms falling in slow motion" \
  --model alibaba/wan-2.6/text-to-video --size 1280*720

uv run scripts/ai-generate.py video "Drone shot over cyberpunk city at night" \
  --model kwaivgi/kling-v3.0-pro/text-to-video --duration 10
```
</details>

---

## 💰 価格

### 🆓 無料ローカルツール — $0

7つのローカルツールはすべて完全に**無料でオープンソース**。

### ☁️ クラウドAI生成 — 従量課金

| モデル | Atlas Cloud | fal.ai | 公式API | 節約 |
|--------|-------------|--------|---------|------|
| Flux Schnell | **$0.003**/枚 | $0.025/枚 | N/A | **88%** |
| Seedream v5.0 | **$0.032**/枚 | N/A | N/A | 独占 |
| Nano Banana 2 | **$0.072**/枚 | N/A | $0.08/枚 | 10% |
| Wan 2.6 (5秒) | **$0.070**/5秒 | $0.50/5秒 | N/A | **86%** |
| Kling v3.0 Pro (5秒) | **$0.204**/5秒 | N/A | $0.70/5秒 | **71%** |

新規ユーザーは**無料クレジット**付き — [APIキーを取得 →](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill)

---

## 📄 ライセンス

MIT License. 詳細は [LICENSE](./LICENSE) をご覧ください。

---

<div align="center">

### 🏆 ゴールドスポンサー

**[Atlas Cloud](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill)** — 300以上のAIモデル統合API

SOC I & II認証 · HIPAA準拠 · fal.aiや公式APIより最大88%お得

<br>

### 使用技術

[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) · [rembg](https://github.com/danielgatis/rembg) · [LaMa](https://github.com/advimman/lama) · [InsightFace](https://github.com/deepinsight/insightface) · [FastSAM](https://github.com/CASIA-IVA-Lab/FastSAM) · [FFmpeg](https://ffmpeg.org/) · [uv](https://github.com/astral-sh/uv)

</div>
