"""Seam tests for the single-shot writer->lint->critic loop (reflective.py).

DSPy-free: every model call is `run_claude_p`, which we monkeypatch. We route a
faked response by prompt content (writer prompts carry the <CURRENT> body block;
critic prompts ask for a VERDICT line). validate_fn is a test double that fails
lint for any body containing the marker "LINTFAIL".
"""

import json
from types import SimpleNamespace

import pytest

from evolution.skills import reflective


def _cfg():
    # claude_model_name only needs the model strings; run_claude_p is patched.
    return SimpleNamespace(optimizer_model="claude-code/sonnet",
                           reviewer_model="claude-code/opus")


def _skill(body="OLD BODY"):
    return {"description": "a test skill", "body": body}


class FakeClaude:
    """Scripted run_claude_p. `writer` and `critic` are lists of responses popped
    per call; records every prompt for assertions."""

    def __init__(self, writer, critic):
        self.writer = list(writer)
        self.critic = list(critic)
        self.writer_prompts = []
        self.critic_prompts = []

    def __call__(self, prompt, model="sonnet", timeout=300):
        if "<CURRENT>" in prompt:  # writer
            self.writer_prompts.append(prompt)
            return self.writer.pop(0)
        # critic
        self.critic_prompts.append(prompt)
        return self.critic.pop(0)


def _validate(body):
    ok = "LINTFAIL" not in body
    return {
        "ok": ok,
        "results": [SimpleNamespace(passed=ok, constraint_name="lint",
                                    message="ok" if ok else "R001: body too long")],
        "evidence": f"lint: {'pass' if ok else 'FAIL'}",
        "lint_errors": "" if ok else "lint: R001: body too long",
    }


def _wrap(body):
    return f"<SKILL_BODY>{body}</SKILL_BODY>"


def test_happy_path_one_round_better(monkeypatch):
    fake = FakeClaude(writer=[_wrap("NEW GOOD BODY")],
                      critic=["VERDICT: BETTER — clearer triggers"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "NEW GOOD BODY"
    assert out["candidate_ok"] is True
    assert out["quality_ok"] is True
    assert out["rounds"] == 1
    assert out["judge_reason"].startswith("BETTER")
    assert len(fake.writer_prompts) == 1 and len(fake.critic_prompts) == 1


def test_lint_fail_then_retry_passes(monkeypatch):
    fake = FakeClaude(writer=[_wrap("LINTFAIL body"), _wrap("clean body v2")],
                      critic=["VERDICT: BETTER — good"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "clean body v2"
    assert out["candidate_ok"] is True
    assert out["quality_ok"] is True
    assert out["rounds"] == 2
    # the 2nd writer call must have been told about the lint failure
    assert "R001" in fake.writer_prompts[1] or "FAILED the cue gate" in fake.writer_prompts[1]


def test_critic_worse_feeds_fixes_back(monkeypatch):
    fake = FakeClaude(
        writer=[_wrap("v1 clean"), _wrap("v2 clean")],
        critic=["VERDICT: WORSE — dropped a flag\nFIXES: restore the --json flag",
                "VERDICT: EQUAL — no real gain\nFIXES: tighten the trigger"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "v2 clean"          # last lint-clean candidate kept
    assert out["candidate_ok"] is True
    assert out["quality_ok"] is False          # never reached BETTER
    assert out["rounds"] == 2
    assert out["judge_reason"].startswith("EQUAL")
    # round-2 writer prompt carries the critic's fixes from round 1
    assert "restore the --json flag" in fake.writer_prompts[1]


def test_lintfail_round_never_clobbers_clean_best(monkeypatch):
    # round1 clean but WORSE; round2 lint-fails → best must remain round1's clean body
    fake = FakeClaude(writer=[_wrap("clean v1"), _wrap("LINTFAIL v2")],
                      critic=["VERDICT: WORSE — meh\nFIXES: do better"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "clean v1"
    assert out["candidate_ok"] is True


def test_critic_outage_keeps_proposal(monkeypatch):
    def boom_or_write(prompt, model="sonnet", timeout=300):
        if "<CURRENT>" in prompt:
            return _wrap("clean candidate")
        raise RuntimeError("claude CLI not on PATH")
    monkeypatch.setattr(reflective, "run_claude_p", boom_or_write)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "clean candidate"
    assert out["candidate_ok"] is True
    assert out["quality_ok"] is False
    assert "critic unavailable" in out["judge_reason"]


def test_writer_outage_falls_back_to_original(monkeypatch):
    def boom(prompt, model="sonnet", timeout=300):
        raise RuntimeError("claude -p timed out")
    monkeypatch.setattr(reflective, "run_claude_p", boom)
    out = reflective.writer_critic_loop(_skill("ORIGINAL"), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["body"] == "ORIGINAL"
    assert out["quality_ok"] is False


def test_critic_step_returns_fixes(monkeypatch):
    monkeypatch.setattr(reflective, "run_claude_p",
                        lambda *a, **k: "VERDICT: WORSE — dropped detail\nFIXES: restore the path; keep the flag")
    is_better, reason, fixes = reflective.critic_step(_skill(), "new body", _cfg())
    assert is_better is False
    assert reason.startswith("WORSE")
    assert "restore the path" in fixes


class GroundedFake:
    """3-way router: skill-run (instructions block), writer (<CURRENT>), critic."""

    def __init__(self, writer, skillrun, critic):
        self.writer, self.skillrun, self.critic = list(writer), list(skillrun), list(critic)
        self.prompts = {"writer": [], "skillrun": [], "critic": []}

    def __call__(self, prompt, model="sonnet", timeout=300):
        if "--- SKILL (instructions to follow) ---" in prompt:
            self.prompts["skillrun"].append(prompt)
            return self.skillrun.pop(0)
        if "<CURRENT>" in prompt:
            self.prompts["writer"].append(prompt)
            return self.writer.pop(0)
        self.prompts["critic"].append(prompt)
        return self.critic.pop(0)


def test_run_skill_on_task(monkeypatch):
    monkeypatch.setattr(reflective, "run_claude_p", lambda prompt, **k: f"ran:{'task X' in prompt}")
    assert reflective.run_skill_on_task("BODY", "do task X", _cfg()) == "ran:True"
    assert reflective.run_skill_on_task("BODY", "   ", _cfg()) == ""  # empty task → no call


def test_run_skill_on_task_outage(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("claude CLI not on PATH")
    monkeypatch.setattr(reflective, "run_claude_p", boom)
    assert reflective.run_skill_on_task("BODY", "task", _cfg()) == ""


def test_critic_step_includes_task_demo(monkeypatch):
    seen = {}

    def cap(prompt, **k):
        seen["p"] = prompt
        return "VERDICT: BETTER — behaved well on the task"
    monkeypatch.setattr(reflective, "run_claude_p", cap)
    is_better, _, _ = reflective.critic_step(_skill(), "newbody", _cfg(), task_demo="THE TRANSCRIPT")
    assert is_better is True
    assert "THE TRANSCRIPT" in seen["p"] and "<DEMO>" in seen["p"]


def test_loop_grounds_critic_with_real_transcript(monkeypatch):
    fake = GroundedFake(writer=[_wrap("clean body")],
                        skillrun=["TRANSCRIPT: skill ran and produced X"],
                        critic=["VERDICT: BETTER — good behaviour"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate,
                                        max_rounds=1, task_input="real user task")
    assert out["quality_ok"] is True
    assert len(fake.prompts["skillrun"]) == 1
    assert "real user task" in fake.prompts["skillrun"][0]          # candidate ran on the mined task
    assert "TRANSCRIPT: skill ran" in fake.prompts["critic"][0]     # critic saw the transcript


def test_representative_task_mining(tmp_path):
    from evolution.skills import evolve_skill
    f = tmp_path / "analytics.jsonl"
    f.write_text(
        '{"event":"skill_gap","skill":"meta/foo","ts":"2026-06-01T00:00:00Z","first_prompt":"old prompt"}\n'
        '{"event":"skill_gap","skill":"meta/foo","ts":"2026-06-10T00:00:00Z","first_prompt":"newer prompt"}\n'
        '{"event":"skill_gap","skill":"meta/bar","ts":"2026-06-11T00:00:00Z","first_prompt":"other skill"}\n'
        '{"event":"skill_hit","skill":"meta/foo","ts":"2026-06-12T00:00:00Z"}\n',
        encoding="utf-8")
    cfg = SimpleNamespace(analytics_log=f)
    assert evolve_skill._representative_task(cfg, "meta/foo") == "newer prompt"  # most recent gap
    assert evolve_skill._representative_task(cfg, "meta/none") == ""             # no gaps
    cfg2 = SimpleNamespace(analytics_log=tmp_path / "missing.jsonl")
    assert evolve_skill._representative_task(cfg2, "meta/foo") == ""             # no file


def test_critic_equal_then_better(monkeypatch):
    # round1 EQUAL (with fixes) → retry → round2 BETTER. The loop's core claim.
    fake = FakeClaude(writer=[_wrap("v1 clean"), _wrap("v2 better")],
                      critic=["VERDICT: EQUAL — flat\nFIXES: sharpen the trigger line",
                              "VERDICT: BETTER — sharper now"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["quality_ok"] is True
    assert out["rounds"] == 2
    assert out["body"] == "v2 better"
    assert "sharpen the trigger line" in fake.writer_prompts[1]   # EQUAL fixes fed forward


def test_all_rounds_lint_fail(monkeypatch):
    fake = FakeClaude(writer=[_wrap("LINTFAIL a"), _wrap("LINTFAIL b")], critic=[])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=2)
    assert out["candidate_ok"] is False
    assert out["quality_ok"] is False
    assert out["judge_reason"] != ""             # clear log sentinel, not blank
    assert len(fake.critic_prompts) == 0          # critic never runs on a lint-failing candidate


def test_max_rounds_one_worse_respects_budget(monkeypatch):
    fake = FakeClaude(writer=[_wrap("only clean body")], critic=["VERDICT: WORSE — nope"])
    monkeypatch.setattr(reflective, "run_claude_p", fake)
    out = reflective.writer_critic_loop(_skill(), _cfg(), validate_fn=_validate, max_rounds=1)
    assert out["rounds"] == 1
    assert out["quality_ok"] is False
    assert out["body"] == "only clean body"
    assert len(fake.writer_prompts) == 1          # budget enforced — no 2nd writer call


def test_evolve_single_shot_integration(tmp_path, monkeypatch):
    """Exercise the REAL evolve() single-shot call site with claude -p and the cue
    gate mocked. The unit tests call writer_critic_loop directly and so cannot
    catch a signature mismatch at the call site — this test can (and does)."""
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))  # isolate log + analytics
    from evolution.skills import evolve_skill

    skill = {"name": "demo", "description": "a demo skill", "body": "OLD BODY",
             "frontmatter": "---\nname: demo\ndescription: a demo skill\n---",
             "raw": "---\nname: demo\ndescription: a demo skill\n---\nOLD BODY"}
    monkeypatch.setattr(evolve_skill, "find_skill", lambda sid, root: tmp_path / "SKILL.md")
    monkeypatch.setattr(evolve_skill, "load_skill", lambda p: skill)

    class FakeValidator:
        def __init__(self, config):
            pass

        def validate_all(self, body, raw, baseline_body=None):
            return [SimpleNamespace(passed=True, constraint_name="lint", message="ok")]
    monkeypatch.setattr(evolve_skill, "ConstraintValidator", FakeValidator)

    def fake_claude(prompt, model="sonnet", timeout=300):
        return ("<SKILL_BODY>NEW IMPROVED BODY</SKILL_BODY>" if "<CURRENT>" in prompt
                else "VERDICT: BETTER — clearer")
    monkeypatch.setattr(reflective, "run_claude_p", fake_claude)

    rc = evolve_skill.evolve(skill_id="meta/demo", optimizer="single-shot",
                             propose_only=True, cue_repo=str(tmp_path))
    assert rc == 0  # would be a TypeError crash if the call site drifted from the loop signature
    props = list((tmp_path / "evolution" / "proposals").rglob("evolved_SKILL.md"))
    assert props, "expected a proposal file in propose-only mode"
    assert "NEW IMPROVED BODY" in props[0].read_text()
    log = tmp_path / "cfg" / "cue" / "evolution-log.jsonl"
    assert log.exists()
    entry = json.loads(log.read_text().strip().splitlines()[-1])
    assert entry["optimizer"] == "writer-loop" and entry["applied"] is False


def test_back_compat_wrappers(monkeypatch):
    # judge_is_better → 2-tuple; propose_improved_body → extracted body
    monkeypatch.setattr(reflective, "run_claude_p",
                        lambda prompt, **k: ("VERDICT: BETTER — ok" if "<CURRENT>" not in prompt
                                             else _wrap("WRAPPED BODY")))
    is_better, reason = reflective.judge_is_better(_skill(), "x", _cfg())
    assert is_better is True and reason == "BETTER: ok"
    assert reflective.propose_improved_body(_skill(), _cfg()) == "WRAPPED BODY"
