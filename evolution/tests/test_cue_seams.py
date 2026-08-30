"""Regression tests for the cue-specific seams (no DSPy / LLM needed).

Covers skill discovery, frontmatter parsing, reassembly, the constraint set,
and the `cue lint-skill` gate. The lint tests skip gracefully when the `cue`
CLI is not on PATH (e.g. minimal CI), so the structural tests still run.
"""

import shutil
import pytest

from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_skill import find_skill, load_skill, reassemble_skill
from evolution.core.constraints import ConstraintValidator
from evolution.core.cue_lint import lint_text

CFG = CueEvolutionConfig()
SAMPLE = "eu-funding/ted-tender-search"
_HAVE_CUE = shutil.which("cue") is not None


def test_repo_and_skills_root_resolve():
    assert CFG.skills_root.exists(), "resources/skills/skills not found from package"


def test_find_skill_by_category_slug():
    p = find_skill(SAMPLE, CFG.skills_root)
    assert p is not None and p.name == "SKILL.md"
    assert p.parent.name == "ted-tender-search"


def test_find_skill_by_bare_slug():
    p = find_skill("ted-tender-search", CFG.skills_root)
    assert p is not None and p.parent.name == "ted-tender-search"


def test_find_skill_missing_returns_none():
    assert find_skill("definitely/not-a-real-skill-xyz", CFG.skills_root) is None


def test_load_skill_parses_frontmatter():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    assert skill["name"] == "ted-tender-search"
    assert skill["description"]
    assert skill["body"] and not skill["body"].startswith("---")


def test_reassemble_preserves_frontmatter():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    rebuilt = reassemble_skill(skill["frontmatter"], "new body here")
    assert rebuilt.startswith("---\n")
    assert "name: ted-tender-search" in rebuilt
    assert "new body here" in rebuilt


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_lint_gate_passes_clean_skill():
    p = find_skill(SAMPLE, CFG.skills_root)
    res = lint_text(p.read_text(), CFG)
    assert res.ran and res.ok and res.score >= 70


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_lint_gate_fails_broken_skill():
    res = lint_text("# heading only\n\nno frontmatter", CFG)
    assert res.ran and not res.ok and res.errors


@pytest.mark.skipif(not _HAVE_CUE, reason="cue CLI not on PATH")
def test_constraint_set_on_real_skill():
    p = find_skill(SAMPLE, CFG.skills_root)
    skill = load_skill(p)
    results = ConstraintValidator(CFG).validate_all(skill["body"], skill["raw"])
    names = {c.constraint_name for c in results}
    assert {"size_limit", "non_empty", "skill_structure", "cue_lint"} <= names
    assert all(c.passed for c in results)


def test_lint_gate_fails_closed_when_cmd_broken():
    """A non-existent lint command must yield ok=False (never silently pass)."""
    cfg = CueEvolutionConfig()
    cfg.lint_cmd = "this-command-does-not-exist-xyz {path} --json"
    res = lint_text("anything", cfg)
    assert not res.ok and not res.ran


def test_reflective_extract_falls_back_without_sentinel():
    """Model output lacking the sentinels must yield the ORIGINAL body (safe
    no-op), never raw error-prose that could get applied."""
    from evolution.skills.reflective import _extract_body
    fb = "ORIGINAL BODY"
    # No sentinel (e.g. a refusal) -> fallback.
    assert _extract_body("Sorry, I can't help with that.", fb) == fb
    # With sentinel -> extracted, fences stripped.
    assert _extract_body("<SKILL_BODY>\n```md\nNEW BODY\n```\n</SKILL_BODY>", fb) == "NEW BODY"
    # Empty sentinel content -> fallback.
    assert _extract_body("<SKILL_BODY></SKILL_BODY>", fb) == fb


def test_auto_evolve_selects_top_existing_skill(tmp_path, monkeypatch):
    """Seeded skill_gap events → pick the most-flagged skill that EXISTS and is
    not in cooldown (the auto-trigger CHECK)."""
    from datetime import datetime, timezone
    from evolution.auto_evolve import select_skill
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    cfg = CueEvolutionConfig()  # skills_root auto-resolves to the real repo
    now = datetime.now(timezone.utc)
    ts = now.isoformat()
    al = cfg.analytics_log
    al.parent.mkdir(parents=True, exist_ok=True)

    def ev(skill, n):
        return "\n".join(
            f'{{"ts":"{ts}","event":"skill_gap","source":"critic","skill":"{skill}"}}'
            for _ in range(n))

    # nonexistent skill is most-flagged (5) but must be skipped; ted (3) wins.
    al.write_text("\n".join([
        ev("nope/does-not-exist", 5),
        ev("eu-funding/ted-tender-search", 3),
        ev("hostinger/dns", 1),
    ]) + "\n", encoding="utf-8")

    skill, count = select_skill(cfg, window_days=7, cooldown_days=7,
                                now=now.timestamp())
    assert skill == "eu-funding/ted-tender-search" and count == 3

    # Cooldown: mark ted recently evolved → next existing skill (dns) is chosen.
    cfg.evolution_log.write_text(
        f'{{"ts":"{ts}","kind":"skill-content","skill":"eu-funding/ted-tender-search","applied":true}}\n',
        encoding="utf-8")
    skill2, _ = select_skill(cfg, window_days=7, cooldown_days=7, now=now.timestamp())
    assert skill2 == "hostinger/dns"


def test_judge_is_better_parses_verdicts(monkeypatch):
    """The self-judge maps only BETTER → apply; everything else (incl. an
    unparseable reply) → don't apply. Conservative by design."""
    import evolution.skills.reflective as r
    skill = {"description": "d", "body": "orig"}
    cfg = CueEvolutionConfig()
    cases = {
        "VERDICT: BETTER — clearer triggers": True,
        "VERDICT: WORSE - dropped a command": False,
        "VERDICT: EQUAL — just reworded": False,
        "i think it's fine": False,  # unparseable → False
    }
    for reply, expected in cases.items():
        monkeypatch.setattr(r, "run_claude_p", lambda *a, **k: reply)
        ok, reason = r.judge_is_better(skill, "revised", cfg)
        assert ok is expected, f"{reply!r} -> {ok}, expected {expected} ({reason})"


def test_config_rejects_lint_cmd_without_path_placeholder():
    """A lint_cmd lacking {path} would lint nothing — reject it at construction."""
    with pytest.raises(ValueError):
        CueEvolutionConfig(lint_cmd="cue lint-skill --json")


def test_lint_gate_fails_closed_on_stray_braces():
    """Stray braces in lint_cmd must not raise — they must fail closed (M1)."""
    cfg = CueEvolutionConfig()
    cfg.lint_cmd = "echo {path} {unexpected}"  # {unexpected} would crash str.format
    res = lint_text("anything", cfg)
    assert not res.ok  # never raises, never silently passes


# ── #3: critical-token regression gate ──────────────────────────────────────

def test_critical_tokens_extracts_code_paths_urls():
    from evolution.core.regression import critical_tokens
    body = ("Run `cue lint-skill {path} --fix` then read "
            "resources/hooks/auto-evolve.sh and https://cuecards.cc/api/v1/me.")
    toks = critical_tokens(body)
    assert "cue lint-skill {path} --fix" in toks
    assert "resources/hooks/auto-evolve.sh" in toks
    assert any(t.startswith("https://cuecards.cc") for t in toks)


def test_check_preservation_flags_dropped_command():
    from evolution.core.regression import check_preservation
    base = "Always run `cue doctor --fix` before shipping."
    kept = "Before shipping, always run `cue doctor --fix`."   # reworded, token kept
    dropped = "Before shipping, run the doctor."                # command deleted
    assert check_preservation(base, kept) == (True, [])
    ok, miss = check_preservation(base, dropped)
    assert not ok and "cue doctor --fix" in miss


def test_constraint_set_includes_critical_tokens_when_baseline_given():
    from evolution.core.constraints import ConstraintValidator
    cfg = CueEvolutionConfig()
    base_body = "Run `cue use medusa-dev` to pin the profile."
    evolved_body = "Pin the profile."  # dropped the command
    full = "---\nname: x\ndescription: y\n---\n" + evolved_body
    results = ConstraintValidator(cfg).validate_all(evolved_body, full, baseline_body=base_body)
    crit = [c for c in results if c.constraint_name == "critical_tokens"]
    assert crit and not crit[0].passed and "cue use medusa-dev" in (crit[0].details or "")


# ── #4 + #5: L1 soft-load + learning events drive selection ──────────────────

def test_count_skill_gaps_credits_softload_and_learning(tmp_path):
    from evolution.auto_evolve import count_skill_gaps
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).isoformat()
    al = tmp_path / "analytics.jsonl"
    al.write_text("\n".join([
        # L1 hook event: no skill field, soft-load names "coolify" in signals.
        f'{{"ts":"{ts}","event":"skill_gap","source":"hook","signals":["tool-error","soft-load:coolify"]}}',
        # learning bridge event: explicit skill.
        f'{{"ts":"{ts}","event":"skill_gap","source":"learning","skill":"meta/next-steps"}}',
        # critic event: explicit skill (existing behavior).
        f'{{"ts":"{ts}","event":"skill_gap","source":"critic","skill":"meta/next-steps"}}',
    ]) + "\n", encoding="utf-8")
    counts = count_skill_gaps(al, window_days=7,
                              now=datetime.now(timezone.utc).timestamp())
    assert counts.get("coolify") == 1              # L1 soft-load now counts
    assert counts.get("meta/next-steps") == 2      # learning + critic


def test_skills_from_event_dedups_within_one_event():
    """One event = at most one vote per skill, even if both the `skill` field and
    a soft-load signal name it (M2)."""
    from evolution.auto_evolve import _skills_from_event
    out = _skills_from_event({"skill": "coolify",
                              "signals": ["soft-load:coolify", "soft-load:dns"]})
    assert out.count("coolify") == 1 and "dns" in out


# ── #7: post-apply canary + auto-revert ──────────────────────────────────────

def _seed_canary(tmp_path, monkeypatch, gap_count, apply_offset_s=-3600):
    """Set up an applied evolution + N post-apply gaps. Returns (cfg, now, path)."""
    from datetime import datetime, timezone
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    cfg = CueEvolutionConfig()
    now = datetime.now(timezone.utc).timestamp()

    def iso(epoch):
        return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()

    skill_dir = tmp_path / "skill"
    skill_dir.mkdir()
    path = skill_dir / "SKILL.md"
    path.write_text("EVOLVED", encoding="utf-8")
    backup = skill_dir / "SKILL.md.bak"
    backup.write_text("ORIGINAL", encoding="utf-8")

    apply_ts = now + apply_offset_s
    cfg.evolution_log.parent.mkdir(parents=True, exist_ok=True)
    cfg.evolution_log.write_text(
        f'{{"ts":"{iso(apply_ts)}","kind":"skill-content","skill":"cat/slug",'
        f'"applied":true,"path":"{path}","backup":"{backup}"}}\n', encoding="utf-8")
    # gaps AFTER the apply (newer ts).
    gaps = "\n".join(
        f'{{"ts":"{iso(now)}","event":"skill_gap","source":"critic","skill":"cat/slug"}}'
        for _ in range(gap_count))
    if gaps:
        cfg.analytics_log.write_text(gaps + "\n", encoding="utf-8")
    return cfg, now, path


def test_canary_reverts_on_friction_spike(tmp_path, monkeypatch):
    from evolution.core.canary import check_canaries
    cfg, now, path = _seed_canary(tmp_path, monkeypatch, gap_count=2)
    actions = check_canaries(cfg, window_hours=48, threshold=2, now=now)
    assert len(actions) == 1 and actions[0]["reverted"]
    assert path.read_text() == "ORIGINAL"          # backup restored
    # a revert record was logged → a second pass is a no-op (no flapping).
    assert check_canaries(cfg, window_hours=48, threshold=2, now=now) == []


def test_canary_holds_below_threshold(tmp_path, monkeypatch):
    from evolution.core.canary import check_canaries
    cfg, now, path = _seed_canary(tmp_path, monkeypatch, gap_count=1)
    assert check_canaries(cfg, window_hours=48, threshold=2, now=now) == []
    assert path.read_text() == "EVOLVED"           # left in place


def test_canary_ignores_pre_apply_friction(tmp_path, monkeypatch):
    """Gaps that predate the apply (the ones that TRIGGERED it) must not revert."""
    from datetime import datetime, timezone
    from evolution.core.canary import check_canaries
    cfg, now, path = _seed_canary(tmp_path, monkeypatch, gap_count=0)
    old = datetime.fromtimestamp(now - 7200, tz=timezone.utc).isoformat()  # before apply
    cfg.analytics_log.write_text("\n".join(
        f'{{"ts":"{old}","event":"skill_gap","source":"critic","skill":"cat/slug"}}'
        for _ in range(5)) + "\n", encoding="utf-8")
    assert check_canaries(cfg, window_hours=48, threshold=2, now=now) == []
    assert path.read_text() == "EVOLVED"


# ── #2: independent reviewer for the single-shot gate ────────────────────────

def test_judge_uses_reviewer_model_not_optimizer(monkeypatch):
    """The quality gate must call the INDEPENDENT reviewer_model (opus), not the
    proposer's optimizer_model (sonnet), and pass the evidence through."""
    import evolution.skills.reflective as r
    cfg = CueEvolutionConfig()
    cfg.optimizer_model = "claude-code/sonnet"
    cfg.reviewer_model = "claude-code/opus"
    seen = {}

    def fake(prompt, model="sonnet", timeout=180):
        seen["model"] = model
        seen["prompt"] = prompt
        return "VERDICT: BETTER — clearer"

    monkeypatch.setattr(r, "run_claude_p", fake)
    ok, _ = r.judge_is_better({"description": "d", "body": "orig"}, "new",
                              cfg, evidence="cue_lint: pass; critical_tokens: pass")
    assert ok and seen["model"] == "opus"          # reviewer, not the proposer
    assert "critical_tokens: pass" in seen["prompt"]  # evidence reached the judge


# ── #1: LLMJudge wired in as an opt-in metric ────────────────────────────────

def test_make_judge_metric_returns_composite(monkeypatch):
    pytest.importorskip("dspy")
    from evolution.core import fitness as F

    class _Score:
        composite = 0.73

    class _FakeJudge:
        def __init__(self, *a, **k):
            pass

        def score(self, **k):
            return _Score()

    monkeypatch.setattr(F, "LLMJudge", _FakeJudge)
    metric = F.make_judge_metric(CueEvolutionConfig(), skill_text="body")

    class _Ex:
        task_input = "do x"
        expected_behavior = "x done well"

    class _Pred:
        output = "x done"

    assert metric(_Ex(), _Pred()) == 0.73

    class _Empty:
        output = "   "
    assert metric(_Ex(), _Empty()) == 0.0  # empty output → 0.0, no judge call
