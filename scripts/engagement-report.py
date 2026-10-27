#!/usr/bin/env python3
"""engagement-report — join article drafts ↔ Postiz analytics, rank what worked.

Scans ~/Documents/cue/drafts/*.md for articles whose frontmatter has been
back-written with the Postiz post IDs that distributed them. For each post ID,
calls `postiz analytics:post <id> -d <days>` and joins the engagement metrics
back against the article's voices / preset / keywords.

Outputs three ranked tables:
  1. By voice mix    — which voice combos drive engagement
  2. By preset       — which writing format performs
  3. By primary kw   — which topics resonate

Expected article frontmatter (back-written by /trend-to-thread + /article-to-everywhere):

    postiz:
      x: cmpl...
      linkedin: cmpl...
      reddit: cmpl...

Run as:
  scripts/engagement-report.py
  scripts/engagement-report.py --days 30
  scripts/engagement-report.py --drafts-dir ~/Documents/cue/drafts --out /tmp/report.md
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
PRESET_RE = re.compile(r"^preset:\s*(\S+)", re.MULTILINE)
VOICES_RE = re.compile(r"^voices:\s*\[([^\]]*)\]", re.MULTILINE)
PRIMARY_RE = re.compile(r"^\s*primary:\s*\"?([^\"\n]+?)\"?\s*$", re.MULTILINE)
POSTIZ_BLOCK_RE = re.compile(r"^postiz:\s*\n((?:\s+\w+:.*\n)+)", re.MULTILINE)
POSTIZ_ENTRY_RE = re.compile(r"\s+(\w+):\s*(\S+)")


def parse_article(path: Path) -> dict | None:
    text = path.read_text()
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    fm = m.group(1)

    postiz_m = POSTIZ_BLOCK_RE.search(fm)
    if not postiz_m:
        return None
    postiz = {k: v for k, v in POSTIZ_ENTRY_RE.findall(postiz_m.group(1))}

    preset_m = PRESET_RE.search(fm)
    preset = preset_m.group(1) if preset_m else "unknown"
    voices_m = VOICES_RE.search(fm)
    voices = []
    if voices_m:
        voices = [v.strip().strip("\"'") for v in voices_m.group(1).split(",") if v.strip()]
    primary_m = PRIMARY_RE.search(fm)
    primary = primary_m.group(1) if primary_m else "unknown"

    return {
        "path": path,
        "postiz": postiz,
        "preset": preset,
        "voices": voices,
        "primary": primary,
    }


def fetch_analytics(post_id: str, days: int) -> dict:
    try:
        out = subprocess.run(
            ["postiz", "analytics:post", post_id, "-d", str(days)],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return {"_error": str(exc)}
    if out.returncode != 0:
        return {"_error": out.stderr.strip() or "non-zero exit"}
    text = out.stdout.strip()
    start = text.find("{")
    if start < 0:
        start = text.find("[")
    if start < 0:
        return {"_error": "no JSON in output"}
    try:
        return json.loads(text[start:])
    except json.JSONDecodeError as exc:
        return {"_error": f"json decode: {exc}"}


def metric_keys(payload: dict | list) -> dict[str, float]:
    keys = ("likes", "reposts", "retweets", "replies", "impressions", "views", "engagement_rate", "engagements")
    out: dict[str, float] = {}
    if isinstance(payload, dict):
        for k, v in payload.items():
            if k in keys and isinstance(v, (int, float)):
                out[k] = float(v)
    elif isinstance(payload, list) and payload:
        return metric_keys(payload[-1] if isinstance(payload[-1], dict) else {})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--drafts-dir", type=Path, default=Path.home() / "Documents/cue/drafts")
    ap.add_argument("--out", type=Path, default=None, help="optional: write the report to a markdown file")
    args = ap.parse_args()

    if not args.drafts_dir.exists():
        print(f"drafts dir not found: {args.drafts_dir}", file=sys.stderr)
        return 2

    articles = []
    for md in sorted(args.drafts_dir.glob("*.md")):
        art = parse_article(md)
        if art:
            articles.append(art)

    if not articles:
        print("no articles with `postiz:` back-write found. Nothing to report.")
        print("Run /trend-to-thread or /article-to-everywhere with the postiz back-write enabled first.")
        return 0

    print(f"engagement-report  →  {len(articles)} article(s) with Postiz IDs, days={args.days}")

    by_voice_mix: dict[str, list[float]] = defaultdict(list)
    by_preset: dict[str, list[float]] = defaultdict(list)
    by_primary: dict[str, list[float]] = defaultdict(list)

    rows = []
    for art in articles:
        for platform, post_id in art["postiz"].items():
            metrics = fetch_analytics(post_id, args.days)
            if "_error" in metrics:
                print(f"  · {art['path'].name} [{platform} {post_id}]  ERROR: {metrics['_error']}", file=sys.stderr)
                continue
            m = metric_keys(metrics)
            engagement = (
                m.get("likes", 0)
                + m.get("reposts", 0)
                + m.get("retweets", 0)
                + m.get("replies", 0)
            )
            rows.append({
                "article": art["path"].name,
                "platform": platform,
                "post_id": post_id,
                "preset": art["preset"],
                "voices": ", ".join(art["voices"]) or "(none)",
                "primary": art["primary"],
                "engagement": engagement,
                "impressions": m.get("impressions", 0) or m.get("views", 0),
            })
            by_voice_mix[", ".join(sorted(art["voices"])) or "(none)"].append(engagement)
            by_preset[art["preset"]].append(engagement)
            by_primary[art["primary"]].append(engagement)

    if not rows:
        print("  No analytics available yet. Posts may be draft-only or too new.")
        return 0

    def render() -> str:
        lines = []
        lines.append(f"# Engagement report — last {args.days} days\n")
        lines.append(f"Articles correlated: {len(articles)} · posts measured: {len(rows)}\n")
        lines.append("## Per-post detail\n")
        lines.append("| Article | Platform | Preset | Voices | Engagement | Impressions |")
        lines.append("|---|---|---|---|---:|---:|")
        for r in sorted(rows, key=lambda x: -x["engagement"]):
            lines.append(
                f"| {r['article'][:40]} | {r['platform']} | {r['preset']} | {r['voices'][:40]} | "
                f"{r['engagement']:.0f} | {r['impressions']:.0f} |"
            )
        def rank_block(title: str, d: dict[str, list[float]]) -> list[str]:
            block = [f"\n## Ranked by {title} (avg engagement)\n", "| Key | n | avg | total |", "|---|---:|---:|---:|"]
            for k, vals in sorted(d.items(), key=lambda kv: -sum(kv[1]) / max(len(kv[1]), 1)):
                avg = sum(vals) / max(len(vals), 1)
                block.append(f"| {k[:60]} | {len(vals)} | {avg:.1f} | {sum(vals):.0f} |")
            return block
        lines.extend(rank_block("voice mix", by_voice_mix))
        lines.extend(rank_block("preset", by_preset))
        lines.extend(rank_block("primary keyword", by_primary))
        return "\n".join(lines)

    report = render()
    print()
    print(report)
    if args.out:
        args.out.write_text(report)
        print(f"\nwrote {args.out}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
