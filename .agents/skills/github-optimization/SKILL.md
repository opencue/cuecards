---
name: github-optimization
description: "Optimize any GitHub repo for maximum stars, traffic, followers, and discoverability. Rewrites README as a high-converting landing page with SEO-optimized headers, shields.io badges, star/follow CTAs, keyword-rich description and topics, humanized copywriting, and author attribution. Includes a star growth knowledge base with launch strategies, channel playbooks, and ROI rankings. Use when user says 'optimize GitHub', 'improve my repo', 'GitHub SEO', 'optimize README', 'get more stars', 'improve my GitHub', 'make repo better', 'polish GitHub', 'github-optimization', '/github-optimization', 'how to get stars', 'launch strategy', 'promote my repo'."
---

# GitHub Repository Optimization

Transform any GitHub repository into a high-converting, SEO-optimized landing page that drives stars, followers, and traffic. Every repo you touch should look like a top-100 open source project.

This skill has two modes:
1. **Optimize** — rewrite a repo's README, metadata, and structure for maximum conversion
2. **Advise** — give the user a star growth strategy using the knowledge base below

## Goals (in priority order)

1. **Stars** -- the primary social proof metric on GitHub
2. **Followers** -- drive traffic to the repo owner's social profiles
3. **Discoverability** -- rank in GitHub search, Google, and LLM answer engines
4. **Traffic** -- turn visitors into users/followers
5. **Professional credibility** -- signal quality through structure and polish

---

## Step 0: User Configuration (Self-Updating)

Before optimizing, you need to know who owns this repo. This step runs once -- after that, the config is reused.

### Check for existing config

Look for `~/.Codex/skills/github-optimization/.config.yml`. If it exists, load the values and skip to Step 1. Show the user what's loaded and ask if anything changed.

### If no config exists, detect + ask

1. **Detect automatically** from git config and GitHub API:
   - `gh api user` -- gets the authenticated GitHub username and profile URL
   - `gh api repos/<owner>/<repo>` -- gets the repo owner (could be org or user)
   - `git config user.name` -- gets the local git display name

2. **Ask the user** for anything you can't detect:
   - **Display name** -- their real name or preferred attribution (e.g., "Jane Smith")
   - **X/Twitter handle** -- for the Follow badge (e.g., "@janesmith"). If they don't want it, skip it.
   - **Company or organisation** -- for footer attribution (optional)
   - **Company URL** -- link for the company name (optional)
   - **Website URL** -- personal or company site (optional)

3. **Save the config** to `~/.Codex/skills/github-optimization/.config.yml`:

```yaml
# GitHub Optimization Skill — User Config
# This file is auto-generated. Edit anytime.
author_name: "Jane Smith"
author_github: "janesmith"
x_handle: "janesmith"          # leave empty string "" to skip Follow badge
company_name: "Acme Corp"      # leave empty string "" to skip
company_url: "https://acme.com"
website_url: "https://janesmith.dev"
```

4. **Use these variables** throughout the pipeline:
   - `{OWNER}` -- GitHub username or org (from repo URL, detected per-repo)
   - `{REPO}` -- repository name (detected per-repo)
   - `{AUTHOR_NAME}` -- from config
   - `{AUTHOR_GITHUB}` -- from config
   - `{X_HANDLE}` -- from config (may be empty)
   - `{COMPANY_NAME}` -- from config (may be empty)
   - `{COMPANY_URL}` -- from config (may be empty)
   - `{WEBSITE_URL}` -- from config (may be empty)

If any field is empty, omit that element entirely from the output. No empty placeholders or broken badges.

### Updating config

If the user says "update my config", "change my X handle", or similar, update the `.config.yml` file and confirm the change.

---

## The Optimization Pipeline

```
0. CONFIG       -> Load or create user config (runs once, self-updates)
1. AUDIT        -> Read current README, description, topics, repo structure
2. KEYWORDS     -> Identify target search terms for this repo's domain
3. METADATA     -> Optimize repo name, description (About), and topics
4. README       -> Rewrite as a landing page following the template below
5. HUMANISE     -> Run the humanise-text skill on all prose to strip AI patterns
6. EXTRAS       -> Add LICENSE, CONTRIBUTING.md if missing
7. PUBLISH      -> Commit, push, apply gh repo edit for description/topics
```

## Skill Chaining

This skill calls other skills during execution:

- **`humanise-text`** -- After drafting the README, invoke the `humanise-text` skill on all prose sections. This strips AI writing patterns and makes the copy sound like a real person wrote it. Non-negotiable -- every README must pass through this.

---

## Step 1: Audit

Read the current state:
- README.md content and structure
- Repo description (About section)
- Topics/tags
- License
- File structure
- Any existing badges

Note what's missing, what's weak, what's good.

## Step 2: Keyword Research

Identify 3-5 target keywords that developers would search for to find this project. Consider:
- What problem does this solve?
- What technology does it use?
- What domain is it in?

These keywords must appear in: **repo name** (if possible), **About description**, **README H1 and H2 headers**, and **topic tags**.

## Step 3: Metadata Optimization

### About Description
- **Under 120 characters ideal**, max 250
- Lead with what it does, not what it is
- Include primary keyword naturally
- Format: `<Action verb> <what> for <who/what>. <Key differentiator>.`

### Topic Tags
Select 10-20 tags across three categories:
1. **Purpose tags** -- what the project does
2. **Tech stack tags** -- technologies used
3. **Domain tags** -- field or industry

Apply with:
```bash
gh repo edit {OWNER}/{REPO} --add-topic tag1 --add-topic tag2 ...
```

---

## Step 4: README Rewrite

The README is a landing page, not documentation.

### README Template

Adapt badges based on what user info is available in the config:

```markdown
<div align="center">

# <Project Name>

**<One-line pitch -- what it does in plain English>**

<br />

[![Star this repo](https://img.shields.io/github/stars/{OWNER}/{REPO}?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow)](https://github.com/{OWNER}/{REPO}/stargazers)
```

**If {X_HANDLE} is set, add next to the star badge:**
```markdown
&nbsp;&nbsp;
[![Follow @{X_HANDLE}](https://img.shields.io/badge/Follow_%40{X_HANDLE}-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/{X_HANDLE})
```

**If {X_HANDLE} is empty, skip the Follow badge entirely.**

Then continue with credential badges:
```markdown
<br />

[![<Badge 1>](shields-url)](<link>)
&nbsp;
[![<Badge 2>](shields-url)](<link>)

---

<One paragraph pitch. What pain does this solve? Why should someone care?>

[Install](#install) | [How It Works](#how-it-works) | [Features](#features) | [Contributing](#contributing)

</div>
```

### Badge Rules

**Row 1 (CTAs -- large, prominent):**
- Star badge with live count -- ALWAYS first, `style=for-the-badge`, yellow
- Follow on X badge -- ONLY if {X_HANDLE} is set

**Row 2 (Credential badges -- same size):**
- All badges use `style=for-the-badge` -- never mix sizes
- Pick 2-4 relevant: License, PRs Welcome, language/framework, build status

### Section Order

1. **Why This Exists / The Problem** -- 2-3 sentences on the pain point
2. **Before vs After** (optional) -- comparison table
3. **Install / Quick Start** -- under 5 steps, one command ideal
4. **How It Works** -- visual workflow (ASCII diagram, table, or numbered steps)
5. **Features / Use Cases** -- table or bullet list, scannable
6. **What's Inside / Structure** -- file tree if relevant
7. **Configuration / Options** (optional)
8. **Security** (optional)
9. **Contributing** -- short, welcoming
10. **License** -- one line
11. **Footer with CTAs** -- star + follow badges repeated

### Footer Template

Build dynamically from config:

```markdown
---

<div align="center">
```

**Attribution line -- build from available config fields:**
- If author + company + website: `Built by [NAME](GITHUB) at [COMPANY](COMPANY_URL) | [WEBSITE](WEBSITE_URL)`
- If author + company (no website): `Built by [NAME](GITHUB) at [COMPANY](COMPANY_URL)`
- If author + website (no company): `Built by [NAME](GITHUB) | [WEBSITE](WEBSITE_URL)`
- If author only: `Built by [NAME](GITHUB)`
- If nothing: `Built with the github-optimization skill`

```markdown
<br />

**If this is useful to you:**

[![Star this repo](star-badge-url)](stargazers-url)
```

If {X_HANDLE} exists, add Follow badge here too.

```markdown
</div>
```

---

## Writing Rules

Non-negotiable. These define the voice.

### DO:
- Write like a human explaining to a friend. Short sentences. Active voice.
- Lead every section with the value, not the mechanism
- Use "you" and "your" -- speak directly to the reader
- Be specific over abstract
- Keep paragraphs to 2-3 sentences max
- Use tables for comparisons

### DO NOT:
- Use AI slop: "leverage", "streamline", "empower", "seamlessly", "robust", "cutting-edge", "revolutionize", "harness the power of", "elevate your workflow", "supercharge"
- Start sentences with "This project..." or "This tool..."
- Write walls of text
- Use passive voice
- Add filler words: "basically", "essentially", "simply", "just"
- Use exclamation marks

### SEO in Headers:
- H1 must contain the primary keyword
- H2s should contain secondary keywords naturally
- Write for humans first, but be deliberate about placement

---

## Step 5: Extras

Add if missing:
- **LICENSE** -- MIT unless user specifies otherwise
- **CONTRIBUTING.md** -- short, welcoming, 3-step process

Do NOT add unless asked: CODE_OF_CONDUCT.md, SECURITY.md, .github/ISSUE_TEMPLATE/

## Step 6: Publish

1. Commit all changes with a descriptive message
2. Push to remote
3. Update repo metadata via `gh repo edit`
4. Report to user: what changed, the new description, topics added, live URL

---

## Checklist Before Done

- [ ] Config loaded or created (no hardcoded usernames anywhere)
- [ ] Star badge with live count at top
- [ ] Follow badge ONLY if user has X handle configured
- [ ] All badges same size (for-the-badge)
- [ ] One-line pitch under H1
- [ ] README reads like a landing page
- [ ] No AI slop words
- [ ] Install section under 5 steps
- [ ] Visual element present (diagram, table, or file tree)
- [ ] H1/H2 contain target keywords
- [ ] About description under 120 chars
- [ ] 10-20 topic tags
- [ ] Footer repeats CTAs with correct user attribution
- [ ] LICENSE exists
- [ ] No broken links
- [ ] Committed and pushed

---

# Star Growth Knowledge Base

When users ask "how do I get more stars?", "launch strategy", "promote my repo", or similar, use this knowledge base to advise them. This section is reference material, not part of the optimization pipeline.

## Channel Rankings (by ROI)

| Rank | Tactic | Effort | Expected Stars | Risk |
|---|---|---|---|---|
| 1 | **Stacked launch** (HN + Reddit + X + PH same day) | High (1 day prep) | 200-2,000+ | None |
| 2 | **Awesome list submissions** | Low (PRs) | Slow burn, compounds | None |
| 3 | **README optimization + social preview** | Medium (1 hour) | 3x multiplier on all other efforts | None |
| 4 | **GitHub SEO** (name, topics, description) | Low (30 min) | Passive long-term discovery | None |
| 5 | **Demo GIF/video in README** | Medium | Dramatically higher conversion | None |
| 6 | **Create your own awesome list** | Medium | Slow burn + cross-promote | None |
| 7 | **Newsletter submissions** | Low (emails) | 50-500 per feature | None |
| 8 | **YouTube tutorials** | High | Best sustained long-term driver | None |
| 9 | **Reciprocal listicle on X** | Low | Network-dependent | None |
| 10 | **Hacktoberfest tagging** (October) | Low | 50-200 seasonal | Spam PRs |
| 11 | **Discord/community building** | High ongoing | Retention/advocacy | None |
| 12 | **Conference talks** | High | Low direct, high compounding | None |

## Hacker News Playbook

**Best time:** Tuesday-Thursday, 8-10 AM Pacific. Sunday 6-9 PM Pacific for lower competition.

**Title format:** `Show HN: [Name] — [What it does concretely]`

**What works:** Write like a peer, not a marketer. No buzzwords. Lead with the problem. Respond to every comment in the first hour. Post your own substantive first comment within 5 minutes.

**Thresholds:** 8-10 genuine upvotes + 2-3 thoughtful comments in first 30 minutes to crack top 10.

**Account requirements:** 250+ karma with technical comment history for best results. Fresh accounts face moderation.

**Ring detection is aggressive.** Never tweet "please upvote my HN post." Use private channels (email, Slack, Discord) to notify people.

**Real results:**
- Lago: #1 for 48+ hours, primary driver to 1,000 stars
- Encore: 1,500 stars in one week from a single Show HN
- Average: 121 stars in 24 hours, 289 in one week

## Reddit Playbook

**Build karma 2+ weeks before posting.** Reddit's 90/10 rule: 90% genuine activity, 10% self-promotion.

| Subreddit | Notes |
|---|---|
| r/SideProject (453K) | Explicitly allows self-promo |
| r/programming (6M+) | Strict anti-promo, "how we built X" works |
| r/selfhosted (500K+) | Converts extremely well |
| r/webdev | "Showoff Saturday" only |
| r/opensource | Link-friendly, lower volume |
| r/coolgithubprojects | Specifically for GitHub repos |

**Expected:** 50-300 stars per successful post. Tailor messaging per subreddit.

## Product Hunt Playbook

**Voting resets:** 12:01 AM PST daily. Upvotes hidden first 4 hours.

**Upvotes for #1:** 600-800 weekday, 400-600 weekend.

**Best days:** Tuesday-Thursday.

**Expected:** 200-1,000 stars from top-5 Product of the Day. #1 can deliver 500-2,000+.

**Timeline:**
- 4-6 weeks out: Build 200-500 email subscribers
- 1 week out: Prepare all assets
- Launch day: Go live 12:01 AM PST, reply to everything, email blast 6 AM PST

## Twitter/X Playbook

**What works:** Short demo videos/GIFs outperform text. Tweets from supporters drive more stars than self-tweets. Weekday mornings US time (9-11 AM ET).

**Expected:** 7% increase in starring from tweeting. Viral video tweets can hit 1,600 stars in 6 hours.

## The Stacked Launch Strategy

The meta-strategy every fast-growing repo used:

| Timing | Action | Expected Stars |
|---|---|---|
| Week before | Submit to newsletters (TLDR, Console.dev, Changelog) | -- |
| Launch day AM | Post HN "Show HN" (Tue-Wed, 8-11am ET) | 121 avg, up to 1,500 |
| Launch day PM | Post Reddit (r/programming, r/selfhosted, domain sub) | 50-300 |
| Launch day | Tweet demo video + get supporters to share | 50-500+ |
| Launch day | Product Hunt launch | 200-1,000 |
| Day 2-3 | GitHub Trending triggers from combined velocity | 200-2,000+ |
| Week after | Publish "how I built X" on Dev.to | 20-100 + SEO tail |

## GitHub Trending Algorithm

Measures **star velocity relative to your historical average**, not absolute numbers. A repo averaging 2 stars/day that gets 20 will trend faster than one averaging 50 that gets 60. Updates ~10-11 AM UTC daily.

## GitHub SEO

- **Repo name is the H1 tag.** `ai-chatbot-framework` ranks for "chatbot framework." Self-descriptive beats clever.
- **About description** appears in Google snippets and GitHub topic pages. Treat it like a meta description.
- **Topic tags (10-20):** Most underoptimized field. Mix purpose, tech stack, and industry.
- **Freshness signal:** Even small commits keep you alive in search rankings.

## Awesome Lists Strategy

Submit to relevant awesome lists via PR. Key requirements for sindresorhus/awesome:
- 30-day minimum age from first real commit
- Not AI-generated content
- Review 4 other open PRs before submitting
- Main branch named `main`

Creating your own awesome list is also effective:
1. Pick a niche you own
2. Seed with 30-50 quality entries including your repos
3. Submit your list to meta-lists
4. Make contributing easy with fast PR merges

## Newsletter Directory

| Newsletter | How to Submit |
|---|---|
| Console.dev | Email hello@console.dev |
| Changelog News | changelog.com/news/submit |
| JavaScript Weekly | Email editor@cooperpress.com |
| PyCoder's Weekly | pycoders.com/submissions |
| This Week in Rust | PR on github.com/rust-lang/this-week-in-rust |
| DevOps Weekly | devopsweekly.com |
| TLDR | Paid only: advertise.tldr.tech |

## Growth Hacks (Quick Wins)

1. **Social preview image** -- Settings > Social Preview. Determines click-through on every share.
2. **Demo GIF in first screenful** -- highest-impact README element
3. **Star-bait at moment of value** -- CLI prompt after successful install, not before
4. **Reciprocal listicles** -- "Top 10 tools for X" on X, tag maintainers. Many reshare.
5. **GitHub profile as funnel** -- pin 6 best repos, profile README as landing page
6. **Hacktoberfest tagging** -- October, `hacktoberfest` tag, 50-200 stars
7. **Milestone giveaways** -- at 1k stars, star + follow + tag friends
8. **GitHub Actions Marketplace** -- publishing an action creates permanent listing
9. **Cross-repo linking** -- link between your repos in READMEs and "See Also" sections
10. **All Contributors bot** -- adds people to README table, creates investment/advocacy

## Cold Start: First 100 Stars

First 100 come from people you know. Direct messages, personal asks (~60% conversion from acquaintances). Promoting with fewer than 100 stars has low conversion everywhere.

- **0-100:** Network grind. DMs, personal asks.
- **100-1,000:** Social proof compounds. Public launches become viable.
- **1,000+:** GitHub Trending becomes reachable.
- **After trending:** Growth feeds itself.

## The Core Insight

The repos that grow fastest hit at the exact moment a massive wave of developer attention was cresting. You can't manufacture that. What you can control is the conversion layer -- making sure that when attention arrives, the repo captures it. README as landing page, badges, CTAs, metadata, SEO, social preview. That's the 3x multiplier. The stacked launch is the closest thing to a reproducible strategy for creating the velocity spike that triggers GitHub Trending.
