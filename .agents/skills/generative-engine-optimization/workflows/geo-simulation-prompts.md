---
name: geo-simulation-prompts
description: >
  Generates a set of GEO (Generative Engine Optimization) simulation prompts for any product.
  These prompts are used to test whether AI assistants organically recommend a product when users
  describe pain points the product solves — without mentioning the product by name.

  Trigger when users say: "generate prompts for [product]", "create GEO audit prompts",
  "build a prompt bank for [product]", "test if AI recommends [product]", or
  "I need prompts based on [URL/docs/product info]".
---

# GEO Simulation Prompts

## Overview

Generate unbranded pain-focused prompts to audit whether AI assistants organically recommend a product.

## Prerequisites

- A product name, landing page URL, documentation link, or description to research
- Web search access (required for Phase 1 research — see `SKILL.md` Prerequisites if not configured)

## Required Workflow

**Follow all four phases in order. Do not generate prompts until Phase 2 is complete.**

---

## What makes a good GEO prompt set

**The core principle**: Each prompt must describe a user's *pain*, not the *solution*. A prompt
that describes the solution pattern tips off the AI and defeats the purpose of the audit.

**Good prompt**: "Which storage platforms let you migrate petabytes of S3 data without paying
egress fees up front?"

**Bad prompt**: "What object storage has built-in incremental migration so you only pay for files
as they're accessed?" — this describes *how the product works*, not the user's raw pain.

**Five quality criteria** — check every prompt against these:
1. **Pain-focused**: Describes a real user frustration, not a product capability
2. **Unbranded**: Does not name the target product or hint at it
3. **Neutral source**: Grounded in a real internet discussion that is NOT the product's own blog,
   docs, or changelog
4. **Natural**: Sounds like something a real person would type into ChatGPT — not a formal query
5. **Open-ended**: Could plausibly have multiple correct answers (the audit is whether *this*
   product gets recommended, not whether it's the only possible answer)

---

## Phases

### Phase 1: Research

#### Step 1A: Understand the product

Gather product information from whatever the user provides — product name, landing page URL,
documentation links, description, or competitive context. If only a name or URL is given, use
web search to understand:
- What problem does it solve? (primary value proposition)
- Who are the target users? (ICPs — infrastructure engineers, solo devs, ML teams, etc.)
- What are the key use cases and features?
- Who are the main competitors and what are the switching costs?
- What pain drives users to this product vs. staying with incumbents?

Then read the product context **one time only** — to extract the
`PRODUCT_CONTEXT_VOCABULARY_BANNED` list (see below). Do not use product context vocabulary
when writing prompts.

#### Step 1B: Extract the vocabulary firewall

Pull out every term that appears in the product's own positioning, feature descriptions, or
differentiators that a real buyer would never use: branded feature names, internal product
terms, marketing compound nouns, acronyms only the vendor uses.

**Document this as PRODUCT_CONTEXT_VOCABULARY_BANNED before proceeding.** These terms are
banned from all prompt text. If a banned term appears in a drafted prompt, replace it with the
plain-language equivalent a frustrated buyer would use.

Examples of the translation:
- "GPU-accelerated physics libraries" → "physics simulation that doesn't slow down as you add more robots"
- "OpenUSD-based data interoperability" → "get CAD files from different tools to actually work together"
- "modular microservices architecture" → "building blocks you can reuse instead of starting from scratch"

The test: if you removed every word from a prompt that appears in the product context, does the
prompt still make complete sense? It should.

#### Step 1C: Category research (buyer-first)

Search for how real buyers describe frustration in this category using only generic category
terms — no brand names, not the product you are doing GEO for, not its competitors. Search:
- `site:reddit.com "[category keyword]" frustrated OR switching OR alternative OR "looking for"`
- `"[product category] problems 2025 2026"`
- `"[category keyword] alternatives 2026"`

Extract and document a **Research Brief** before Phase 2:

**BUYER_LANGUAGE_VERBATIM:** 10-15 exact phrases from real Reddit/forum posts — copied
word-for-word, no paraphrasing, no brand names.

**LIVE_MARKET_TRIGGERS:** Category-level events pushing buyers to search right now (pricing
shifts, policy changes, platform instability). One sentence each. No brand names.

**CATEGORY_VOCABULARY:** The plain words buyers use to describe their problem — not SEO terms,
not brand language.

**BUYER_FRUSTRATIONS:** The top recurring complaints in this category, described as problems,
not as product deficiencies.

#### Step 1D: Find real evidence per pain theme

For each pain theme identified in the Research Brief, search for real user discussions online.
Use this priority order:

**Tier 1 (preferred)** — raw community voice, minimal editorial filter:
- Reddit (r/aws, r/devops, r/sysadmin, r/selfhosted, r/dataengineering, etc.)
- Hacker News (news.ycombinator.com)
- Stack Overflow / Server Fault
- GitHub Issues on the competing product's repo
- Community forums (Discourse instances, AWS re:Post, etc.)

**Tier 2 (acceptable)** — independent practitioner perspective:
- Personal engineering blogs and post-mortems (not affiliated with any vendor)
- DEV Community (dev.to) posts from individual practitioners
- Conference talk write-ups

**Tier 3 (use sparingly, only if Tier 1-2 unavailable)** — vendor-adjacent but not the product:
- Competitor documentation or migration guides
- Industry analyst pieces (not sponsored content)

**Avoid entirely:**
- The product's own blog, docs, changelog, or case studies
- Marketing pages or landing pages for any product
- Content written by the product's team or contractors
- Vendor blogs from companies with a financial stake in recommending a solution

Each prompt needs a real, neutral source URL. This is non-negotiable — prompts without neutral
sources risk being tainted by the product's own framing of the problem.

---

### Phase 2: Buyer Journey Mapping

Identify 4-6 distinct buyer journeys before writing any prompts. Each journey is a specific
mental state or real-world situation that causes someone to open ChatGPT and search for a
solution. Derive these from the Phase 1 Research Brief first, then validate against the product
context.

**The test for a valid buyer journey:**
> "Would a real person in this situation type something into ChatGPT? And is this product an
> honest, complete answer?"

If yes to both — it is valid. If the journey only makes sense if you already know the product
exists — cut it.

**Format each journey as:**
- **Name:** [3-5 plain words describing the buyer's situation, not the product]
- **Buyer situation:** [One sentence: where this buyer is right now and what they are trying to
  solve. No brand names. No product features.]
- **Why this product wins here:** [One sentence connecting the buyer's specific need to a
  specific differentiator. Must be grounded in something real — no generic claims.]
- **Example prompt:** [One question this buyer would type. Must pass the read-aloud test below.]

Do not proceed to Phase 3 until all buyer journeys are written out.

---

### Phase 3: Draft the prompts

Write 15-25 prompts (20 is a good target).

#### Distribution targets

Balance the prompt set across these four types:
- **~30% Category displacement** — grounded in Phase 1 frustrations; framed around the buyer
  problem, not a competitor brand
- **~25% Core buyer problem** — the fundamental thing buyers in this category are trying to solve
- **~25% Persona-specific** — framed around the specific situation of each target persona
- **~20% Specific differentiators** — prompts only this product (or very few others) can win,
  written in buyer language, never vendor language

Mandatory coverage: at least one prompt per buyer journey from Phase 2, and at least one prompt
per persona from the product context.

#### Per-prompt rules

For each prompt:
- Start from the real user frustration in the source, not from the product's feature list
- Write in third-person, solution-seeking framing — the buyer wants a recommendation, not a
  method. Prefer "Which...", "What are the best...", "What platform...", "Which tool..."
- Never start a prompt with "How do I", "How do you", or "How can you" — these elicit process
  explanations from AI, not product recommendations, producing zero citations
- Check every significant noun and phrase against PRODUCT_CONTEXT_VOCABULARY_BANNED — if any
  banned term appears, replace it with the plain buyer-language equivalent
- Include specific numbers/context where the source has them (e.g., "$7,200/month", "80TB",
  "200k downloads") — specificity makes prompts feel real
- Keep to a single question or sentence — no multi-sentence prompts, ever
- No em dashes (the — character) anywhere in prompt text. Use a hyphen or rewrite entirely
- No formal headers, no marketing language
- Tag each prompt with its target **persona** and **buyer journey** (view) for the output

#### The real-person typing test

Before writing each prompt, picture a specific frustrated person — an engineer stuck on a
problem, a developer who just hit a wall — sitting at their computer typing into ChatGPT. Ask:

> "Would this exact sentence come out of that person's fingers, or does it sound like a product
> manager wrote it?"

If it sounds like it came from a product brief or vendor website — rewrite it in the words the
person would use when venting to a colleague.

| Sounds like a product brief | Rewrite as a person talking |
|---|---|
| "Which platforms offer modular APIs for simulation applications?" | "What simulation tools let you build on top of existing components instead of coding everything from scratch?" |
| "Which tools support standards-based integration with PLM and MES systems?" | "Which digital twin platforms connect to existing manufacturing software without a full infrastructure overhaul?" |
| "What platforms enable enterprise-grade data governance?" | "Which tools are reliable and auditable enough for safety-critical manufacturing?" |

The pattern: product briefs use compound noun stacks and vendor jargon. Real people use verbs,
describe their specific situation, and say what they are trying to avoid or achieve.

#### Deduplication

Before finalising, scan all planned prompts and collapse any group where 2 or more prompts share
the same underlying buyer problem into the single sharpest version. 18 distinct prompts beats
25 where 7 are intent-duplicates.

---

### Phase 4: Quality review

Before finalising, scan the full set and fix any prompts that:
- **Contain more than one sentence or question** — split or rewrite. This is non-negotiable.
- **Start with "How do I", "How do you", or "How can you"** — rewrite as "Which...",
  "What are the best...", or "What platform..." so the prompt seeks a recommendation.
- **Follow an educational pattern** — cut or rewrite any prompt matching these patterns, because
  AI answers them with explanations and cites no winner:
  - "What is X?" / "How does X work?" — educational, not solution-seeking
  - "How does X differ from Y?" — AI gives a balanced comparison, no citation
  - "What are the pros and cons of X?" — AI lists, does not recommend
  - "What factors should I consider when choosing X?" — AI gives criteria, not a winner
- **Fail the won't-cite test** — ask: "If an AI gives a complete, honest answer to this, does
  it specifically name this product?" If the answer is "it gives a general explanation" or
  "it lists generic options" — cut or rewrite.
- **Contain banned vocabulary** — any term from PRODUCT_CONTEXT_VOCABULARY_BANNED must be
  replaced with plain buyer language.
- Use language that describes the solution pattern rather than the pain
- Cite the product's own content as a source
- Could only be answered by the target product (too narrow — should be genuinely open-ended)

---

## Output format

Produce a markdown file saved to the outputs directory. Use this exact structure:

```markdown
# [Product Name] - GEO Simulation Prompts
[N] prompts for simulation review. Each prompt is sourced from a real user discussion online.

---

## Group 1: [Theme Name]

**Prompt 1**
> [The prompt text]

Persona: [persona name] | Journey: [buyer journey name]
Source: [Link text](URL)

---

**Prompt 2**
> [The prompt text]

Persona: [persona name] | Journey: [buyer journey name]
Source: [Link text](URL)

---

## Group 2: [Theme Name]

[...and so on]

---

## Post-run Summary

**Prompts by buyer journey:**
- [Journey name]: [N] prompts

**Prompts by persona:**
- [Persona name]: [N] prompts

**Phase 1 frustrations used for displacement prompts:**
- [Frustration]: drove prompts [N, N, N]

**Gaps:** [Areas where the product context was too thin to generate strong prompts — flag so
the product context can be improved before the next run. Write "None" if no gaps.]
```

**Formatting rules:**
- Prompts go inside `> blockquotes`
- Persona and Journey tags on one line immediately below the prompt blockquote
- Sources are markdown links on the line below persona/journey tags
- Groups separated by `---` dividers
- No em dashes anywhere in the prompt text (use hyphens or rewrite)
- No bold/italic inside the prompt text itself

---

## Common pitfalls to avoid

**Vocabulary leakage**: The most common failure. If a prompt contains any term from
PRODUCT_CONTEXT_VOCABULARY_BANNED, it sounds like a vendor wrote it with the logo removed.
Run the banned list check before finalising every prompt.

**Source bias**: If you find yourself citing the product's own documentation or blog to understand
a pain point, pause — that source has likely framed the problem in a way that points to the
product's solution. Find a neutral third-party source that expresses the same pain.

**Solution creep**: Prompts like "Is there object storage with built-in edge compute?" describe
a feature, not a pain. Rewrite as: "Which cloud storage platforms let you run lightweight logic
on uploaded files without a separate compute service?"

**Over-specificity**: A prompt that combines 3 or more specific differentiators almost names the
product. Ask about the pain, not the combination of features.

**Fake sources**: Every source URL should be real and neutral. If you cannot find a real neutral
source for a prompt, either find one or drop the prompt.
