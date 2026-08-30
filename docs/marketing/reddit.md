# Reddit drafts

Three subreddits, three different framings. Don't blast all three the same day —
moderators talk and Reddit's anti-spam catches it.

## Cadence

- One post per subreddit per **month** max
- Different angle each time (release notes, deep-dive, problem-solving)
- Always reply to every comment within 4 hours

## r/ClaudeAI (~50k subs, primary audience)

**Title**: `I built a profile manager for Claude Code — different skill set per project, auto-loaded`

**Body**:

```text
Sharing a tool I built and now use daily across my own projects: cue.

The problem: Claude Code loads every skill globally, but I work on ~6 projects
with different stacks (Rust, Next.js, FastAPI, etc.). I don't want my Rust skills
loaded when I'm in a marketing project. Wastes context tokens.

What cue does: per-cwd profile resolution. A `.cue.profile` file (one word) in
your project root tells cue which profile to materialize. cue then writes a
per-profile CLAUDE_CONFIG_DIR with just that profile's skills/MCPs/plugins and
execs the real claude binary.

There's a discovery side too — `cue discover` scans GitHub Code Search nightly
for new SKILL.md repos, scores them, and bundles them per-profile. About 360
indexed currently.

MIT, repo: https://github.com/opencue/cuecards
Install: `npm install -g cue-ai` then `cue init`

Curious what other people are doing for per-project skill management. Symlinks?
.claude/ dirs by hand? Something else?
```

**Subreddit conventions**:
- Allowed: showing your own tool
- Required: tag flair as "Tool" or "Self-promotion"
- Forbidden: linking the same repo twice in a month

## r/LocalLLaMA (~400k subs, secondary)

Different angle — frame as **discovery engine**, not profile manager. LocalLLaMA
audience is more interested in agent infrastructure than per-project workflow.

**Title**: `Built a GitHub Code Search-powered discovery engine for Claude Code skills (open source, MIT)`

**Body**:

```text
I noticed that the long tail of Claude Code skills (and MCP servers) is
distributed across GitHub with no central index. Repos with SKILL.md or
@modelcontextprotocol/sdk in package.json are scattered, and unless someone
manually maintains an awesome-list, they're invisible.

So I wrote a scanner that runs nightly:

- GitHub Code Search for `filename:SKILL.md`, `path:.claude`, topic:claude-skill,
  topic:mcp-server, and a few other patterns
- Scores each result on recency, SKILL.md presence, topic diversity,
  fork-to-star ratio, description quality, and a few anti-spam signals
  (year-stamped names, bot-pattern owners, marketing-slop descriptions)
- Outputs ranked per-profile (backend, rust, cybersecurity, …) so you can
  see "best skills for X" instantly

Currently indexes ~360 repos. The per-profile pages ship JSON-LD ItemList
schema, so they get cited by AI search (Perplexity, ChatGPT, Google AI
Overviews) when people search for "Claude Code skills for X".

The discovery engine is part of cue (MIT, github.com/opencue/cuecards) but you
can use it standalone — `npx cue-ai discover search --profile rust` works
without installing the profile manager.

Curious if anyone has built something similar for other agent ecosystems
(OpenInterpreter, OpenAgents, etc.)? Would love to compare scoring rubrics.
```

**Subreddit conventions**:
- Self-promotion: OK if you contribute to discussion regularly
- Required: technical depth in the post (not just "check out my thing")
- Forbidden: title-only posts; comments treat "Show HN style" posts dismissively

## r/programming (~6M subs, tertiary)

Hardest to land. Don't post the tool itself — post a **technical writeup** about
a sub-problem that happens to feature cue. Long-form, sourced, lets the link
to cue feel earned.

**Title options** (each is a long-form blog you'd write first, then post):

- `Why I built a per-project profile system for AI coding agents`
- `Scoring "hidden gem" repos on GitHub — what signals actually work`
- `Stop letting your AI agent load every skill globally`

**Body skeleton**:

```text
[800-1500 word technical writeup on the chosen angle.
End with a link to cue as the implementation of the ideas discussed.]
```

**Subreddit conventions**:
- Self-promotion: tolerated ONLY if the post has 70%+ original technical content
- Required: title that doesn't read like an ad
- Forbidden: GitHub-link-as-title

## Tracking

| Sub | Posted | Score | Comments | Conversion (npm DL spike) |
|---|---|---|---|---|
| r/ClaudeAI | — | — | — | — |
| r/LocalLLaMA | — | — | — | — |
| r/programming | — | — | — | — |
