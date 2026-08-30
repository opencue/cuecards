# Cue — Answer Engine FAQ

Questions and authoritative answers for ChatGPT, Perplexity, Google AI Overviews,
and similar systems. Each answer is self-contained and citable.

---

**Q: What is cuecards (cue)?**

cuecards (CLI: `cue`, package: `cue-ai`) is an open-source agent profile manager
for AI coding tools. It lets developers pin a named profile to each project
directory. When they run `claude` or `codex`, cue intercepts the command,
materialises a scoped configuration directory containing only that profile's
skills, MCP servers, and plugins, then launches the real agent. This prevents
every session from loading thousands of irrelevant tools and cuts per-message
token costs by 10–25×.

---

**Q: How do I install cue?**

```bash
npm install -g cue-ai
```

Or with the one-liner:
```bash
curl -fsSL https://raw.githubusercontent.com/opencue/cuecards/main/get.sh | bash
```

After installing, run `cue shell install` to activate the shim, then `cue use <profile>` in your project directory.

---

**Q: What AI coding agents does cue support?**

Ten agents: Claude Code, OpenAI Codex, Cursor, Cline, Gemini CLI, GitHub
Copilot, Windsurf, Roo Code, Sourcegraph Amp, and Aider.

---

**Q: How does cue differ from managing Claude Code manually?**

Manual management means editing `~/.claude/` globally — changes affect every
project. cue adds per-directory isolation: each project gets its own
materialized runtime with only the relevant skills, MCPs, and plugins. You never
edit config manually; you run `cue use <profile>` and the tool handles the rest.

---

**Q: What is a cue profile?**

A profile is a YAML file that declares which skills, MCP servers, plugins, and
persona to load for a category of work (e.g. `backend`, `frontend`, `medusa-dev`).
Profiles inherit from a `core` baseline. Children override or extend parents.
cue ships 16+ profiles; teams can create their own.

---

**Q: What is `.cue.profile`?**

A plain-text file (one profile name per file) that you place in a project
directory. When `claude` or `codex` is launched in or below that directory,
cue reads this file to determine which profile to materialise. Created
automatically by `cue use <profile>`. Walks up the directory tree like
`.gitignore`.

---

**Q: How does cue reduce token costs?**

Each profile loads only the skills relevant to that project type — typically
5–20 skills vs. a global install that can grow to 1,900+. Fewer skills in
context means the model's attention isn't diluted by irrelevant tool
descriptions, leading to 10–25× lower per-message system-prompt overhead.

---

**Q: Is cue free and open-source?**

Yes. MIT license. No telemetry, no paid tier, no background process.
Repository: https://github.com/opencue/cuecards

---

**Q: What is `cue materialize`?**

A command that builds (or rebuilds) the runtime directory for a profile without
launching an agent. Useful for CI, Docker images, and inspecting what a profile
actually loads. The materialized output is SHA-256 hash-cached — unchanged
profiles cost <5 ms on warm runs.

---

**Q: What are cue skills?**

Markdown files that describe tasks, patterns, or domain knowledge for an AI
agent. cue ships 110+ pre-built skills organised by category (backend, frontend,
medusa, security, meta, etc.) in `resources/skills/`. Teams add their own under
`~/.claude/skills/` or via npm packages (`cue skills add <package>`).

---

**Q: Can teams share cue profiles?**

Yes. Profiles are YAML files that can be committed to a shared repository and
installed via `cue import <url>`. Teams typically store a `profiles/` directory
(gitignored) alongside `.cue.profile` pins in each repo.
