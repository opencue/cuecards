---
name: ai-slop-detector
description: Use when the user asks to audit, score, humanize, or fix prose for AI-writing signals or readability. Produces separate AI-slop and comprehension findings with actionable edits.
tags: [writing, editing, readability, ai-detection]
triggers:
  - humanize this
  - AI slop check
  - does this sound AI-written
  - readability audit
---

# slop-cop

A universal prose audit with two parallel axes. Built on ~135 published sources spanning peer-reviewed linguistics, AI-detector vendor methodology, plain-language style guides (plainlanguage.gov, GOV.UK, Microsoft, Google), cognitive-load research (Miller, Sweller, Pinker), web-readability research (NN/g), and the Plain Writing Act / WCAG accessibility standards.

## The one-line summary

**Two axes, two verdicts. AI-Slop and Comprehension. A piece can pass one and fail the other.**

- **AI-Slop axis**, Does this read like AI wrote it? Patterns, vocabulary, formatting, rhythm.
- **Comprehension axis**, Can a fresh reader follow this? Acronyms, named-entity bombing, telegraphic compression, readability, structure.

Single instances aren't a signal. Density is. Both axes use density-based scoring (per 500 words, weighted by severity) with the same verdict tiers (PASS / LOW / MEDIUM / HIGH / CRITICAL). The audit reports both and combines them into a single recommendation based on whichever is worse.

---

## Why this skill exists

Our feeds are becoming shit. Our websites are becoming shit. Our repos are becoming shit. AI didn't make writing harder, it made writing easier, and now everyone uses the same shortcuts, the same shapes, the same words. Open ten landing pages in a row and you can't tell them apart.

I built this skill to make my own websites less shit, my clients' websites less shit, and my LinkedIn feed less of a copy-paste graveyard. Yes, AI wrote parts of this skill. That is not the problem. The problem is AI prose nobody catches: the safe, hedge-stacked, em-dash-heavy paragraph where every line is grammatically clean but the whole thing is forgettable.

I run this against my own work every day. Landing pages, blog posts, READMEs, pitch decks, cold emails. It catches the stuff I would have shipped. If someone uses it to score other people's writing, fine. The first job is policing yourself before you ship.

Running it daily means finding new things every week. A pattern I missed. A false alarm on real human prose. A new model with new tells. The list moves with the work. Expect a lot of changes.

---

## Mode selection

Two modes. Pick one based on what the user wants.

| Signal | Mode |
|---|---|
| "audit this", "review", "critique", "is this AI", "is this readable", "score this", "check for slop" | **Audit** |
| "polish", "edit", "rewrite", "humanize", "make this less AI", "fix this", "de-slop", "clean up" | **Audit, then revise** |
| User shares a draft and asks for thoughts | **Audit** (default) |
| Another writing skill is wrapping up and about to deliver prose | **Audit pass before delivery** |

If ambiguous, ask one short question: "Audit only, or do you want a revised version?"

---

## When to skip

This skill governs prose meant for human readers. Skip it for:

- Code, code comments, commit messages, or PR descriptions
- Technical API documentation or reference material (different audience target, see calibration §10)
- Raw data, structured outputs (JSON, YAML, CSV)
- Direct quotations from other people that should preserve their voice
- Instructions to other agents or skills (system prompts, agent briefs)
- Intentionally formal or legal documents (different audience target)
- Dialogue under another character's voice in fiction (apply voice-aware judgment)

---

## Example audit workflow

Five steps. The scanner does the mechanical work on both axes; reading does the qualitative work; calibration converts findings into two verdicts plus a combined recommendation.

### Step 1, Run the scanner

```bash
python3 scripts/scan.py /path/to/draft.md
echo "draft text..." | python3 scripts/scan.py
```

Flags:

```bash
# Compact one-screen output (for embedding in other skills):
python3 scripts/scan.py --quick draft.md

# Structured JSON for programmatic use:
python3 scripts/scan.py --json draft.md
```

Audience calibration:

```bash
# Set audience for comprehension-axis calibration:
python3 scripts/scan.py --audience marketing draft.md
python3 scripts/scan.py --audience academic draft.md
python3 scripts/scan.py --audience technical draft.md
```

Advanced flags:

```bash
# Override AI-slop genre detection:
python3 scripts/scan.py --genre encyclopedic draft.md

# Mahmoud-mode: treat ALL em dashes as H severity:
python3 scripts/scan.py --strict-em-dash draft.md
```

The scanner outputs:
- Two verdicts (AI-Slop, Comprehension) with density scores
- Combined recommendation
- Per-axis violation breakdown
- Readability metrics panel (Flesch RE, FK Grade, SMOG, Coleman-Liau, Dale-Chall, lexical density, avg sentence length, passive voice %)
- Density signals (acronym density, named-entity density, numeric density per sentence)
- Burstiness, contraction ratio, model fingerprint

### Step 2, Read against both pattern catalogs

**AI-Slop axis:** Load `references/patterns.md`. Walk through the 45 patterns by group. The scanner catches the mechanically-detectable subset; the rest requires reading.

**Comprehension axis:** Load `references/comprehension.md`. Walk through the 35 patterns by group. Roughly 17 are mechanically detectable; the rest require reading. Particularly:
- **Buried lede / missing thesis**, does the first paragraph tell the reader the point?
- **No topic sentences**, does each paragraph open with its claim?
- **Curse of knowledge**, does the writer assume context the reader lacks?
- **No concrete examples**, does every abstract claim have a specific instance?
- **Definition by synonym**, are domain terms defined with concrete examples or just other jargon?

For each pattern (both axes), flag with quote + severity.

### Step 3, Apply calibration

Load `references/calibration.md`. Apply:

1. **Density-based scoring on both axes** (§1 for AI-Slop, §9 for Comprehension)
2. **Genre adjustment** (AI-Slop: §3) and **audience calibration** (Comprehension: §10)
3. **Compound triggers**, escalate when 3+ H tells in one paragraph (slop) or any 100w window has 3+ undefined acronyms / 5+ named entities (comp)
4. **Cross-axis recommendation** (§11), single sentence based on whichever axis is worse

The scanner does most of this automatically. The reader applies judgment to ambiguous cases.

### Step 4, Output the audit report

Use the dual-verdict format in `references/audit-report-template.md`. The report has:

- **Two verdicts** (AI-Slop and Comprehension) in a header table
- **Combined recommendation**, one sentence drawn from cross-axis matrix
- **Stats block**, word count, audience, burstiness, model fingerprint
- **AI-Slop axis section**, counts, top fixes, mechanical violations, qualitative violations, calibration notes
- **Comprehension axis section**, counts, top fixes, readability metrics panel, density signals, mechanical violations, qualitative violations, calibration notes
- **Combined top 3 fixes**, pulled from both axes by impact
- **Combined recommended action**, what to do next

Don't soften findings on either axis. The point of the audit is to catch what the writer missed.

### Step 5, If asked, deliver the revision

If the user wanted polish/edit (not just critique), produce the full revised version. The rewrite must address violations on **both axes**:

- Replace AI texture: kill `delve`-class verbs, em-dash clusters, sycophancy, grandiose framing
- Add reader scaffolding: define acronyms inline, break up long paragraphs, add a thesis sentence, contextualize named entities, replace telegraphic colon-labels with sentences
- Hit audience-specific readability targets (FK grade in band, lexical density appropriate, sentence length variance present)
- Don't introduce new tells (re-scan after rewrite if uncertain)

The revision should read as deliverable prose for the target audience.

---

## Quick reference: lethal tells (both axes)

If you only have time for a quick scan, look for these. Each appears in the highest-density failures.

### AI-Slop (20 most lethal)

**Vocabulary:** `delve` / `delves`, `tapestry`, `underscore` / `underscores`, `leverage` (verb), `harness`

**Sentence-level:** "It's not X, it's Y" (negation reversal), "serves as a" / "stands as a" / "boasts" (copula avoidance), "X happened, demonstrating Y" (-ing tail), "From small startups to global enterprises" (false range), "Studies show..." with no citation

**Voice:** `Great question!` (opener sycophancy), `I hope this helps!` (closer sycophancy), `In today's fast-paced world...` (107x more in AI), `As a society, we must...` (royal we), `As of my last update...` (knowledge-cutoff leakage)

**Structural:** `In conclusion` / `Furthermore` / `Moreover` (listicle transitions), `It's worth noting that...` (throat-clearing), em dashes in clusters (3+ per 500w), bold-first bullets, `X: A Comprehensive Guide` titles

### Comprehension (10 most lethal)

1. **Undefined acronyms**, 3+ per 100 words = high cognitive load
2. **Named-entity bombing**, 5+ unfamiliar proper nouns per 100 words
3. **Stat bombing**, 3+ numerics in one sentence with no comparative anchor
4. **Telegraphic colon-labeling**, *Anchor case: X. Tools that win: Y.* Compresses topics into label-list rather than prose
5. **Coined insider terms**, "two-stack social management thesis" used as if known
6. **Long sentences**, over 30 words; comprehension drops sharply
7. **Buried lede**, main point arrives after 2+ paragraphs of setup
8. **Missing thesis**, reader can't summarize the central claim after reading
9. **Wall-of-text**, paragraphs over 100 words with no breathing room
10. **No concrete examples**, every abstract claim left abstract

If a draft has 5+ AI-Slop lethal items in 500 words → AI-Slop HIGH/CRITICAL.
If a draft has 3+ Comprehension lethal items in 500 words → Comprehension HIGH/CRITICAL.

---

## Calibration principles

A short version of the rules in `references/calibration.md`. Read the full file before producing the calibration section of the audit.

### Density formula (both axes)

```
density = (H × 3) + (M × 1) + (L × 0.25)   per 500 words
```

### Verdict thresholds (both axes)

- 0–2 = PASS
- 2–5 = LOW
- 5–10 = MEDIUM
- 10–18 = HIGH
- 18+ = CRITICAL

### AI-Slop axis tuning

- **Genre adjustments:** academic prose can use "studies show" with citations; marketing tolerates more intensifiers; encyclopedic prose triggers false positives (LLMs were trained on Wikipedia); fiction respects character voice
- **Contested tells:** em dashes in clusters = H, alone = L (Mahmoud-mode = always H via `--strict-em-dash`); "actually" survives only contrasting reality with theory
- **Sanded-prose alert:** if famous vocabulary is clean but structural tells are heavy, flag, writer prompt-engineered around the v1 list
- **Uncanny valley:** if 8+ weak tells stack with burstiness below 0.5, escalate one tier

### Comprehension axis tuning

- **Audience calibration** (calibration.md §10): the SAME prose hits different verdicts depending on audience. General web/blog targets FK grade 7–9; marketing 6–8; technical 10–12; academic 12–16. The scanner uses `--audience` to pick the threshold band.
- **Compound triggers escalate one tier:**
  - 3+ undefined acronyms in any 100-word window
  - 5+ named entities in any 100-word window
  - 3+ telegraphic colon-labels in one paragraph
  - Any paragraph over 150 words with no subheading
  - Any sentence over 40 words
- **Readability metrics calibrate, patterns rule:** the metrics panel (FK Grade, lexical density, etc.) is diagnostic. The verdict comes from the catalog patterns. When metrics and patterns disagree, call it out (e.g., "patterns clean but FK Grade 16, academic-density texture without specific failures").

### Cross-axis recommendation

| AI-Slop | Comprehension | Recommendation |
|---|---|---|
| PASS / LOW | PASS / LOW | Ship it. |
| MEDIUM+ | PASS / LOW | AI-Slop revision; reader-friendly already. |
| PASS / LOW | MEDIUM+ | Comprehension revision; texture is fine. |
| MEDIUM+ | MEDIUM+ | Both cleanup; often overlapping fixes. |
| HIGH+ | HIGH+ | Full rewrite. |

---

## Reference loading guide

Read what the task needs.

| File | Read when |
|---|---|
| `references/patterns.md` | AI-Slop qualitative pass. The 45 rhetorical/structural patterns. |
| `references/vocabulary.md` | AI-Slop word-level tells. ~150 items in 7 categories. |
| `references/formatting-tells.md` | AI-Slop formatting checks. ~33 items in 5 categories. |
| `references/comprehension.md` | Comprehension qualitative pass. The 35 patterns in 5 groups. |
| `references/readability-metrics.md` | When interpreting the readability panel. The 8 formulas + thresholds + audience targets. |
| `references/calibration.md` | Always at the start of every audit. Density rules, genre, audience, fingerprints, contested tells, cross-axis matrix. |
| `references/audit-report-template.md` | Always at the start. Defines the dual-verdict output format. |
| `references/sources.md` | When challenged on a specific tell. ~135 sources backing the catalogs. |

The `scripts/scan.py` scanner runs both axes in one pass and produces a report that references the categories and items in these files.

---

## A note on the detector itself

This is a shape-and-comprehension detector, not a classifier. The AI-Slop axis measures whether prose has the *shape* of AI writing, patterns, vocabulary, structure, rhythm. The Comprehension axis measures whether a *fresh reader* can follow it. Neither tells you whether AI wrote a given piece.

A skilled writer using AI as a research tool can produce prose that scores PASS on both axes. A careful prompt can produce LOW on both. A human writing fast can produce HIGH on Comprehension while PASSing AI-Slop. A polished AI marketing post can score CRITICAL on AI-Slop while readable.

Treat the AI-Slop verdict as "this prose has the shape of AI writing." Treat the Comprehension verdict as "a cold reader will struggle here." Both verdicts are actionable.

The catalog will need updating as models change. After `delve` went viral in early 2024, arXiv frequency dropped sharply. After GPT-5.1 added an em-dash opt-out (Nov 2025), em-dash density became less reliable. The skill stays useful by weighting newer patterns higher and surfacing density rather than individual hits.

When the scanner says PASS but the prose still reads wrong, trust the reading, the qualitative patterns (parallel structure, force of metaphors, voice consistency, curse-of-knowledge moments) are what humans pick up first and what regex misses last.
