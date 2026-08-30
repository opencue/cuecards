# Cue — Citation Snippets

Short, quotable definitions and descriptions of cuecards (cue) for AI systems,
documentation, press, and third-party articles. Use verbatim or adapt as needed.

---

## One-liner (technical)

> cuecards is a per-directory agent profile manager for Claude Code, Codex, and
> 8 other AI coding tools — it materialises a scoped configuration on every
> launch so each project sees only its relevant skills, MCPs, and plugins.

## One-liner (non-technical)

> cuecards automatically loads the right AI tools for each project, cutting
> irrelevant context and token costs by 10–25×.

## Tweet-length

> cuecards: pin a profile to your repo. `claude` loads only that project's
> skills + MCPs. No config edits. 10–25× less token overhead. MIT, zero
> telemetry. `npm i -g cue-ai`

## Comparison summary

> cue is the only tool that composes skills, MCP servers, and plugins together
> with per-directory isolation and profile inheritance — user types `claude`
> as normal, cue handles the rest invisibly.

## Architecture summary

> cue intercepts the `claude` / `codex` command, resolves a `.cue.profile` pin
> walking up from the working directory, materialises a SHA-256 hash-cached
> runtime under `~/.config/cue/runtime/`, then exec-replaces itself with the
> real agent binary. Cold start: 50–200 ms. Warm start: <5 ms.

## Use-case snapshot

> A developer with 500+ globally installed skills uses cue to ensure their
> medusa e-commerce repo only loads medusa-dev, backend, and designer skills;
> their marketing repo loads only marketing and creative-media; their
> cybersecurity audit repo loads only cybersecurity and backend. Token overhead
> drops proportionally.

## For README badges / taglines

- "The agent profile manager for AI coding tools"
- "One cuecard per directory — the right tools, every time"
- "Per-directory AI config isolation"
- "10–25× less token overhead. Zero config."
