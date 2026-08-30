"""Single-shot reflective skill-body improver — the lightweight optimizer.

GEPA's iterative loop makes dozens of LLM calls and is slow on every backend.
This optimizer does the job in a few `claude -p` calls: read the current skill
body (plus any friction signals), propose an improved body, lint it, and let an
INDEPENDENT critic judge it — retrying the writer with the lint errors and the
critic's fixes as feedback until it passes or the round budget runs out. The
caller then runs the same `cue lint-skill` gate + apply/proposal decision.

Needs NO DSPy and NO API key — just `claude -p` (the user's Claude Code auth).
This is the path that actually delivers "skills improve as you use cue", and it
is the path the automated Stop-hook loop runs (single-shot, propose-only).

The multi-agent loop (writer -> lint -> critic -> retry) lives in
`writer_critic_loop`. `propose_improved_body` / `judge_is_better` remain as
thin one-shot wrappers so existing callers keep working.
"""

import re

from evolution.core.claude_lm import run_claude_p, claude_model_name


_PROMPT = """You are a cue skill-engineering specialist improving a Claude Code SKILL.md
**body** (the markdown after the YAML frontmatter). Rewrite it to be sharper and
more effective while keeping it lint-clean by cue conventions.

Rules (cue house style — how `cue lint-skill` and reviewers judge it):
- Concise and imperative. Lead each step with the verb or the answer.
- Keep clear trigger cues and a tight, numbered procedure. Every step that runs
  something shows the exact command in a code block, not "you could try…".
- Preserve the skill's intent and EVERY critical command, path, flag, and URL
  verbatim — dropping one is a regression that fails the gate.
- Do NOT include YAML frontmatter. Do NOT bloat it — stay within roughly 20% of
  the current length; shorter is better when nothing is lost.
- Voice: no em dashes; no AI filler (delve, crucial, robust, comprehensive,
  leverage, seamless, furthermore, moreover). Plain, direct sentences.

Skill description (for context, do not edit): {desc}
{signals_block}
Current body:
<CURRENT>
{body}
</CURRENT>

Return ONLY the improved body, wrapped exactly between these markers and nothing
else:
<SKILL_BODY>
...improved body here...
</SKILL_BODY>"""


_LINT_RETRY_TMPL = """
Your PREVIOUS attempt FAILED the cue gate. Fix exactly these and try again,
keeping every critical command/path/flag:
{lint}
"""

_CRITIC_FIX_TMPL = """
An independent reviewer judged a prior rewrite "{verdict_reason}".
Make these concrete fixes this time:
{fixes}
"""


def writer_step(skill: dict, config, signals: str = "", lint_feedback: str = "",
                timeout: int = 300) -> str:
    """One writer `claude -p` call → an improved skill body string.

    `signals` carries observed friction plus any critic fixes from a prior round;
    `lint_feedback` carries the `cue lint-skill` errors from a prior round so the
    writer can repair them. Falls back to the original body if the model returns
    nothing usable (a bad response becomes a no-op "body unchanged", never a
    broken skill).
    """
    model = claude_model_name(config.optimizer_model)
    blocks = ""
    if signals.strip():
        blocks += f"\nObserved friction / fixes to address:\n{signals}\n"
    if lint_feedback.strip():
        blocks += _LINT_RETRY_TMPL.format(lint=lint_feedback)
    prompt = _PROMPT.format(desc=skill["description"], body=skill["body"], signals_block=blocks)
    out = run_claude_p(prompt, model=model, timeout=timeout)
    return _extract_body(out, fallback=skill["body"])


def propose_improved_body(skill: dict, config, signals: str = "", timeout: int = 300) -> str:
    """Back-compat one-shot writer (no lint-retry loop). Thin wrapper over
    `writer_step` so existing callers and tests keep working."""
    return writer_step(skill, config, signals=signals, timeout=timeout)


_JUDGE_PROMPT = """You are a strict, INDEPENDENT reviewer of Claude Code SKILL.md bodies — you did
not write the revision and have no stake in it. Decide whether the REVISED body is
genuinely BETTER than the ORIGINAL for an agent deciding when and how to use this
skill — clearer triggers, tighter procedure, NO loss of critical detail (commands,
paths, constraints). Be conservative: if the revision drops useful content or is
merely different, it is NOT better.

Skill description (context): {desc}
{evidence_block}
ORIGINAL:
<A>
{original}
</A>

REVISED:
<B>
{revised}
</B>
{demo_block}
Reply on the FIRST line, exactly: VERDICT: BETTER|EQUAL|WORSE — <one-line reason>
If the verdict is EQUAL or WORSE, add a SECOND line listing concrete, specific
fixes the writer should make next:
FIXES: <semicolon-separated, imperative — e.g. "restore the `--json` flag; tighten the trigger line">"""


def critic_step(skill: dict, evolved_body: str, config, evidence: str = "",
                task_demo: str = "", timeout: int = 180):
    """Independent reviewer `claude -p` call. Returns
    (is_better: bool, reason: str, suggested_fixes: str).

    Conservative — anything but BETTER → is_better False. On a non-BETTER verdict
    the critic also returns actionable `suggested_fixes` so the writer can repair
    the candidate on the next round. Uses `config.reviewer_model` (a DIFFERENT,
    stronger model than the writer's `optimizer_model`) so the rewrite isn't
    graded by its own author, anchored on deterministic `evidence` (lint/size/
    token-preservation results).

    When `task_demo` is supplied (a transcript of the REVISED skill running on a
    real mined task), the critic judges actual behaviour, not just prose — this
    is the "score by running through a real Claude Code subagent on a mined task"
    signal, grounded in genuine usage.
    """
    model = claude_model_name(config.reviewer_model)
    evidence_block = f"\nDeterministic gate results (already checked):\n{evidence}\n" if evidence.strip() else ""
    demo_block = (f"\nHow the REVISED skill actually behaved on a real past task that"
                  f" needed it (judge the BEHAVIOUR, not just the prose):\n<DEMO>\n"
                  f"{task_demo.strip()[:4000]}\n</DEMO>\n") if task_demo.strip() else ""
    prompt = _JUDGE_PROMPT.format(
        desc=skill["description"], original=skill["body"], revised=evolved_body,
        evidence_block=evidence_block, demo_block=demo_block)
    out = run_claude_p(prompt, model=model, timeout=timeout)
    m = re.search(r"VERDICT:\s*(BETTER|EQUAL|WORSE)\s*[—\-:]*\s*([^\n]*)", out, re.IGNORECASE)
    if not m:
        return False, f"unparseable judge verdict: {out.strip()[:120]}", ""
    verdict = m.group(1).upper()
    reason = f"{verdict}: {m.group(2).strip()[:160]}"
    fm = re.search(r"FIXES:\s*(.+)", out, re.IGNORECASE | re.DOTALL)
    fixes = fm.group(1).strip()[:400] if fm else ""
    return verdict == "BETTER", reason, fixes


def judge_is_better(skill: dict, evolved_body: str, config, timeout: int = 180,
                    evidence: str = ""):
    """Back-compat one-shot reviewer. Thin wrapper over `critic_step` that drops
    the suggested-fixes field. Returns (is_better, reason)."""
    is_better, reason, _ = critic_step(skill, evolved_body, config, evidence=evidence, timeout=timeout)
    return is_better, reason


_SKILL_RUN_PROMPT = """You are using the following Claude Code SKILL to handle a user request.
Follow the skill's instructions exactly as written; do not improvise beyond it.

--- SKILL (instructions to follow) ---
{body}
--- END SKILL ---

User request:
{task}

Respond exactly as you would when actually performing this task using the skill."""


def run_skill_on_task(body: str, task: str, config, timeout: int = 180) -> str:
    """Run a candidate skill body AS INSTRUCTIONS against a real mined task via
    `claude -p`, returning the transcript the critic then judges. DSPy-free.

    Fails soft to "" on any `claude -p` outage, so grounding is best-effort: a
    missing transcript just drops the critic back to text-only review.
    """
    if not task.strip():
        return ""
    model = claude_model_name(config.optimizer_model)
    try:
        return run_claude_p(_SKILL_RUN_PROMPT.format(body=body, task=task.strip()),
                            model=model, timeout=timeout)
    except RuntimeError:
        return ""


def writer_critic_loop(skill: dict, config, validate_fn, max_rounds: int = 2,
                       signals: str = "", task_input: str = "", console=None,
                       timeout_write: int = 300, timeout_judge: int = 180) -> dict:
    """Multi-agent writer -> lint -> critic loop (all `claude -p`, DSPy-free).

    Each round:
      1. WRITER proposes a body (fed the prior round's lint errors AND the
         critic's suggested fixes as feedback).
      2. `validate_fn(body)` runs the cue constraint gate (incl. `cue lint-skill`)
         and returns {ok, results, evidence, lint_errors}.
      3. If lint fails and rounds remain → retry the writer with the lint errors.
      4. CRITIC judges evolved vs baseline. BETTER → accept and stop. EQUAL/WORSE
         with rounds remaining → retry the writer with the critic's fixes.

    Returns the best body seen (a lint-clean candidate is preferred over a
    lint-failing one):
      {body, candidate_ok, results, quality_ok, judge_reason, rounds}

    Runs in propose-only too — the loop still iterates to produce a higher-quality
    PROPOSAL; the caller's `_finalize` is what refuses to apply. Cost scales with
    rounds: up to `max_rounds` writer calls + up to `max_rounds` critic calls.
    """
    max_rounds = max(1, int(max_rounds))
    best = {"body": skill["body"], "candidate_ok": False, "results": None,
            "quality_ok": False, "judge_reason": "no candidate", "rounds": 0}
    lint_feedback = ""
    critic_fixes = ""

    for rnd in range(1, max_rounds + 1):
        extra = "\n".join(s for s in (signals, critic_fixes) if s.strip())
        # Fail-soft: a `claude -p` outage must degrade to "keep best so far"
        # (a proposal), never crash the run — the Stop-hook loop runs unattended.
        try:
            body = writer_step(skill, config, signals=extra, lint_feedback=lint_feedback,
                               timeout=timeout_write)
        except RuntimeError as exc:
            if console:
                console.print(f"  [yellow]✗ round {rnd}: writer unavailable ({exc})[/yellow]")
            break
        v = validate_fn(body)
        changed = body.strip() != skill["body"].strip()

        # Keep this candidate as best-so-far if it's lint-clean, or if we have
        # nothing better yet (first attempt). A later lint-failing round must
        # never clobber an earlier lint-clean one.
        if v["ok"] or best["results"] is None:
            best = {"body": body, "candidate_ok": v["ok"], "results": v["results"],
                    "quality_ok": False,
                    # "" gets overwritten by the critic below; a lint-failing
                    # candidate never reaches the critic, so log WHY, not blank.
                    "judge_reason": "" if v["ok"] else "lint failed; not judged",
                    "rounds": rnd}

        if not v["ok"]:
            lint_feedback = v["lint_errors"]
            if console:
                console.print(f"  [yellow]✗ round {rnd}: lint failed → retry with feedback[/yellow]")
            continue

        if not changed:
            best["judge_reason"] = "body unchanged"
            break

        # Ground the critic in real behaviour: run the candidate on a mined task
        # and let the critic judge the transcript, not just the diff. Best-effort.
        task_demo = run_skill_on_task(body, task_input, config, timeout=timeout_judge) if task_input.strip() else ""
        try:
            is_better, reason, fixes = critic_step(
                skill, body, config, evidence=v["evidence"], task_demo=task_demo,
                timeout=timeout_judge)
        except RuntimeError as exc:
            # Critic outage: keep the lint-clean candidate as a proposal, don't apply.
            best["quality_ok"], best["judge_reason"] = False, f"critic unavailable: {exc}"
            if console:
                console.print(f"  [yellow]✗ round {rnd} critic unavailable ({exc})[/yellow]")
            break
        best["quality_ok"], best["judge_reason"] = is_better, reason
        if console:
            console.print(f"  [{'green' if is_better else 'yellow'}]"
                          f"{'✓' if is_better else '✗'} round {rnd} critic: {reason}[/]")
        if is_better:
            break

        # Not better: feed the critic's fixes back to the writer for another round.
        critic_fixes = _CRITIC_FIX_TMPL.format(verdict_reason=reason, fixes=fixes) if fixes else ""
        lint_feedback = ""  # lint passed this round; don't re-send stale errors

    return best


def _extract_body(text: str, fallback: str) -> str:
    """Pull the body from between the sentinels; tolerate stray fences.

    If the model did NOT emit the sentinels, treat the response as unusable and
    return the original body — so a refusal / error-prose becomes a safe no-op
    ("body unchanged" → proposal), never an applied garbage rewrite.
    """
    m = re.search(r"<SKILL_BODY>(.*?)</SKILL_BODY>", text, re.DOTALL)
    if not m:
        return fallback
    body = m.group(1).strip()
    # Strip a wrapping ```markdown / ``` fence if the model added one.
    body = re.sub(r"^```[a-zA-Z]*\n", "", body)
    body = re.sub(r"\n```$", "", body).strip()
    return body or fallback
