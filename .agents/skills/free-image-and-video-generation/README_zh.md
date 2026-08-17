<div align="center">

# 🎨 免费图片 & 视频 AI Agent 技能

**7 个免费本地 AI 工具 + 300+ 云端 AI 模型 — 一个技能适配所有 AI Agent**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Python 3.10-3.12](https://img.shields.io/badge/Python-3.10--3.12-blue.svg)](https://python.org)
[![uv](https://img.shields.io/badge/uv-package%20manager-blueviolet)](https://docs.astral.sh/uv/)

[English](./README.md) · [中文](./README_zh.md) · [日本語](./README_ja.md) · [한국어](./README_ko.md)

</div>

<br>

### ✨ 为什么选择这个技能？

- 🆓 **完全免费** — 7 个本地 AI 工具离线运行，无需 API Key，无使用限制，零成本
- ⚡ **零配置** — 只需 `uv run` 即可运行，依赖自动安装
- 🔒 **隐私优先** — 所有本地处理都在你的电脑上完成，数据不会上传
- 🌐 **300+ 云端模型** — 通过一个 API 访问 Flux、Seedream、Nano Banana、Kling、Wan 等 300+ 模型 — **比 fal.ai 和官方 API 最高便宜 88%**
- 🤖 **AI Agent 就绪** — 开箱即用，兼容 Claude Code、Cursor、Codex、Copilot 等 15+ AI 编程助手
- 🔗 **生产级工作流** — 串联多个工具：生成 → 超分 → 去背景 → 生成视频

> 🏆 **金牌赞助商**：[Atlas Cloud](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill) — 300+ AI 模型统一 API。SOC I & II 认证 · HIPAA 合规。比 fal.ai 和官方 API 最高便宜 88%。

---

## 📦 安装

### 环境要求

- 🐍 Python 3.10 - 3.12 — [python.org](https://python.org)（部分依赖暂不支持 3.13，`uv` 会自动管理正确版本）
- 📦 uv — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- 🎬 FFmpeg — `brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`

### 安装技能

```bash
# ✅ 方式 1：作为 AI Agent 技能安装（Claude Code、Cursor、Codex 等）
npx skills add ristponex/free-image-and-video-generation-skill

# 📂 方式 2：直接克隆
git clone https://github.com/ristponex/free-image-and-video-generation-skill.git
cd free-image-and-video-generation-skill
```

### ☁️ 云端 AI 配置（可选 — 用于 AI 图片/视频生成）

```bash
# 在 https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill 获取免费 API Key
# （赠送免费额度，无需信用卡）

# Mac / Linux — 添加到 ~/.bashrc 或 ~/.zshrc：
export ATLAS_CLOUD_API_KEY=your_key_here

# Windows (PowerShell)：
$env:ATLAS_CLOUD_API_KEY="your_key_here"
# Windows (永久设置 — 以管理员身份运行)：
setx ATLAS_CLOUD_API_KEY "your_key_here"

# 或者在项目目录创建 .env 文件：
echo 'ATLAS_CLOUD_API_KEY=your_key_here' >> .env
```

---

## 🛠️ 包含内容

### 🆓 免费本地工具 — 无需 API Key，100% 离线

所有本地工具完全在你的电脑上运行。**数据不会离开你的电脑。**

| # | 工具 | 脚本 | 技术支持 | 功能描述 |
|---|------|------|---------|---------|
| 1 | 🔍 **图片超分** | `scripts/upscale.py` | Real-ESRGAN | 2x/4x AI 超分辨率放大 |
| 2 | 👤 **人脸增强** | `scripts/face-enhance.py` | Real-ESRGAN | 修复模糊/老照片，增强细节 |
| 3 | ✂️ **背景去除** | `scripts/bg-remove.py` | rembg (U2-Net) | 去除背景 → 透明 PNG |
| 4 | 🧹 **物体擦除** | `scripts/erase.py` | LaMa Inpainting | 无痕擦除不需要的物体 |
| 5 | 🎭 **换脸** | `scripts/face-swap.py` | InsightFace | 两张图片之间换脸 |
| 6 | 🧩 **智能分割** | `scripts/segment.py` | FastSAM | 通过文字/点/框分割任意物体 |
| 7 | 🎬 **媒体处理** | `scripts/media-process.py` | FFmpeg | 转码、压缩、裁剪、合并、GIF |

### ☁️ 云端 AI 生成 — 通过 Atlas Cloud API 使用 300+ 模型

| # | 工具 | 脚本 | 功能描述 |
|---|------|------|---------|
| 8 | 🎨 **AI 生成** | `scripts/ai-generate.py` | 使用 300+ 云端 AI 模型生成图片和视频 |

**热门模型**：Flux Schnell · Seedream v5.0 · Nano Banana 2 · Imagen4 Ultra · Wan 2.6 · Kling v3.0 · Seedance · Vidu · Hailuo 等

```bash
# 📋 浏览所有可用模型和价格
uv run scripts/ai-generate.py models
```

---

## 📖 使用方法

所有脚本使用 `uv run` — 依赖在首次运行时**自动安装**，零配置。

<details>
<summary>🔍 <b>图片超分</b> — 2x/4x AI 超分辨率（免费）</summary>

```bash
uv run scripts/upscale.py input.jpg                   # 4x 放大（默认）
uv run scripts/upscale.py input.jpg --scale 2          # 2x 放大
uv run scripts/upscale.py input.jpg --face-enhance     # 含人脸增强
uv run scripts/upscale.py ./photos/ --scale 4          # 批量处理文件夹
```
</details>

<details>
<summary>👤 <b>人脸增强</b> — 修复老照片/模糊照片（免费）</summary>

```bash
uv run scripts/face-enhance.py old-photo.jpg                                  # 默认增强
uv run scripts/face-enhance.py old-photo.jpg --method codeformer --fidelity 0.7  # CodeFormer
uv run scripts/face-enhance.py old-photo.jpg --bg-upscale 2                   # 含背景放大
```
</details>

<details>
<summary>✂️ <b>背景去除</b> — 输出透明 PNG（免费）</summary>

```bash
uv run scripts/bg-remove.py product.jpg                        # 去除背景
uv run scripts/bg-remove.py portrait.jpg --alpha-matting        # 精细边缘（头发、毛皮）
uv run scripts/bg-remove.py character.png --model isnet-anime   # 动漫优化
uv run scripts/bg-remove.py ./products/ -o ./transparent/       # 批量处理
```
</details>

<details>
<summary>🧹 <b>物体擦除</b> — 无痕去除（免费）</summary>

```bash
uv run scripts/erase.py photo.png --mask mask.png              # 用蒙版擦除
uv run scripts/erase.py photo.png --region 100,200,150,150     # 按坐标擦除
```
</details>

<details>
<summary>🎭 <b>换脸</b> — 图片换脸（免费）</summary>

```bash
uv run scripts/face-swap.py --source face.jpg --target photo.jpg              # 基本换脸
uv run scripts/face-swap.py --source face.jpg --target group.jpg --face-index 2  # 合照换脸
```
</details>

<details>
<summary>🧩 <b>智能分割</b> — 分割万物（免费）</summary>

```bash
uv run scripts/segment.py image.jpg --text "the dog"    # 文字提示
uv run scripts/segment.py image.jpg --point 400,300     # 点选
uv run scripts/segment.py image.jpg                     # 分割全部
```
</details>

<details>
<summary>🎬 <b>媒体处理</b> — FFmpeg 驱动（免费）</summary>

```bash
uv run scripts/media-process.py convert video.mp4 output.webm          # 格式转换
uv run scripts/media-process.py compress video.mp4 --target-size 10    # 压缩
uv run scripts/media-process.py frames video.mp4 --fps 1               # 提取帧
uv run scripts/media-process.py gif video.mp4 --start 5 --duration 3   # 创建 GIF
uv run scripts/media-process.py trim video.mp4 --start 00:01:00 --end 00:02:30
uv run scripts/media-process.py merge clip1.mp4 clip2.mp4 -o combined.mp4
uv run scripts/media-process.py info video.mp4                         # 媒体信息
```
</details>

<details>
<summary>🎨 <b>AI 图片生成</b> — 300+ 云端模型（Atlas Cloud）</summary>

```bash
uv run scripts/ai-generate.py models --type image

uv run scripts/ai-generate.py image "A cat astronaut on the moon" \
  --model black-forest-labs/flux-schnell --size 1024*1024

uv run scripts/ai-generate.py image "Anime character with blue hair" \
  --model google/nano-banana-2/text-to-image --aspect-ratio 1:1 --resolution 1k

uv run scripts/ai-generate.py image "Product photo, studio lighting" \
  --model bytedance/seedream-v5.0-lite --size 2048*2048
```
</details>

<details>
<summary>🎥 <b>AI 视频生成</b> — 电影级 AI 视频（Atlas Cloud）</summary>

```bash
uv run scripts/ai-generate.py models --type video

uv run scripts/ai-generate.py video "Cherry blossoms falling in slow motion" \
  --model alibaba/wan-2.6/text-to-video --size 1280*720

uv run scripts/ai-generate.py video "Drone shot over cyberpunk city at night" \
  --model kwaivgi/kling-v3.0-pro/text-to-video --duration 10
```
</details>

---

## 💰 价格

### 🆓 免费本地工具 — $0

全部 7 个本地工具完全**免费开源**，随意使用。

### ☁️ 云端 AI 生成 — 按量付费

| 模型 | Atlas Cloud | fal.ai | 官方 API | 节省 |
|------|-------------|--------|---------|------|
| Flux Schnell | **$0.003**/张 | $0.025/张 | N/A | **88%** |
| Seedream v5.0 | **$0.032**/张 | N/A | N/A | 独家 |
| Nano Banana 2 | **$0.072**/张 | N/A | $0.08/张 | 10% |
| Imagen4 Ultra | **$0.054**/张 | N/A | $0.06/张 | 10% |
| Wan 2.6 (5秒) | **$0.070**/5秒 | $0.50/5秒 | N/A | **86%** |
| Kling v3.0 Pro (5秒) | **$0.204**/5秒 | N/A | $0.70/5秒 | **71%** |

> 显示的是当前促销的基础价格。最终价格可能因分辨率、时长等因素有所不同。

新用户注册即送**免费额度** — [获取 API Key →](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill)

---

## 📄 许可证

MIT License. 详见 [LICENSE](./LICENSE)。

---

<div align="center">

### 🏆 金牌赞助商

**[Atlas Cloud](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill)** — 300+ AI 模型统一 API

SOC I & II 认证 · HIPAA 合规 · 比 fal.ai 和官方 API 最高便宜 88%

<br>

### 基于以下开源项目

[Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) · [rembg](https://github.com/danielgatis/rembg) · [LaMa](https://github.com/advimman/lama) · [InsightFace](https://github.com/deepinsight/insightface) · [FastSAM](https://github.com/CASIA-IVA-Lab/FastSAM) · [FFmpeg](https://ffmpeg.org/) · [uv](https://github.com/astral-sh/uv)

</div>
