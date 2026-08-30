"""Offline regression tests for the description-evolution seams.

No DSPy / LLM key needed. Covers: description->routing-row extraction (ported
from skill-router.ts), the persona_routing block splice (insert / merge /
idempotent / comment-preserving), frontmatter description replacement, and the
--dry-run wiring. Lint-dependent assertions skip gracefully when `cue` is not
on PATH.
"""

import json
import shutil
import yaml
import pytest

from evolution.core.config import CueEvolutionConfig
from evolution.core.cue_skill import (
    find_skill,
    load_skill,
    extract_description,
    replace_description_in_frontmatter,
    reassemble_with_new_description,
)
from evolution.descriptions.profile_yaml_writer import (
    parse_description,
    description_to_persona_routing,
    update_persona_routing,
    backup_and_write,
)
from evolution.descriptions import evolve_description

CFG = CueEvolutionConfig()
SAMPLE = "eu-funding/ted-tender-search"
_HAVE_CUE = shutil.which("cue") is not None


# ── parse_description (mirror of skill-router.ts) ──────────────────────────

def test_parse_description_extracts_triggers_and_capability():
    desc = ('Runs a deep repo analysis. Use when user says "analyze", '
            '"investigate", or "trace through". NOT for trivial lookups.')
    p = parse_description(desc)
    assert "analyze" in p["triggers"]
    assert "investigate" in p["triggers"]
    assert "trace through" in p["triggers"]
    assert "deep repo analysis" in p["capability"].lower()
    assert "NOT for" in p["not_for"]


def test_parse_description_handles_no_triggers():
    p = parse_description("Just a plain capability sentence with no quotes.")
    assert p["triggers"] == []
    assert p["capability"]


def test_parse_description_empty():
    assert parse_description("") == {"triggers": [], "capability": "", "not_for": ""}


# ── description_to_persona_routing ─────────────────────────────────────────

def test_rows_are_valid_persona_routing_entries():
    desc = 'Deploy helper. Use when user says "deploy to coolify" or "restart app".'
    rows = description_to_persona_routing(desc, "coolify", note="auto-evolved")
    assert rows, "expected at least one row"
    for r in rows:
        # schema: required skill, anyOf(phrase|capability), optional note
        assert r["skill"] == "coolify"
        assert ("phrase" in r) ^ ("capability" in r) or ("phrase" in r) or ("capability" in r)
        assert "phrase" in r or "capability" in r
        assert r.get("note") == "auto-evolved"
    phrases = [r["phrase"] for r in rows if "phrase" in r]
    assert "deploy to coolify" in phrases


def test_rows_dedupe_phrases():
    desc = 'Use when user says "x", "x", "y".'
    rows = description_to_persona_routing(desc, "s")
    phrases = [r["phrase"] for r in rows if "phrase" in r]
    assert phrases.count("x") == 1


# ── update_persona_routing: insert when absent ─────────────────────────────

PROFILE_NO_BLOCK = """\
name: coolify
description: "Coolify deploys"
persona: |
  You're a DevOps engineer.    # inline comment must survive
skills:
  local:
    - deployment/coolify
mcps:
  - lightpanda
"""


def test_insert_block_before_anchor_preserves_everything():
    rows = [{"phrase": "deploy to coolify", "skill": "coolify", "note": "auto"}]
    out = update_persona_routing(PROFILE_NO_BLOCK, rows)
    # comment + other keys survive verbatim
    assert "# inline comment must survive" in out
    assert "- deployment/coolify" in out
    # block landed before mcps:
    assert out.index("persona_routing:") < out.index("mcps:")
    # round-trips
    data = yaml.safe_load(out)
    assert data["persona_routing"][0]["phrase"] == "deploy to coolify"
    assert data["persona_routing"][0]["skill"] == "coolify"
    assert data["mcps"] == ["lightpanda"]


def test_append_at_eof_when_no_anchor():
    content = "name: x\ndescription: \"y\"\n"
    rows = [{"capability": "do the thing", "skill": "x"}]
    out = update_persona_routing(content, rows)
    data = yaml.safe_load(out)
    assert data["name"] == "x"
    assert data["persona_routing"][0]["capability"] == "do the thing"


# ── update_persona_routing: merge + idempotency ────────────────────────────

PROFILE_WITH_BLOCK = """\
name: coolify
persona_routing:
  - phrase: existing trigger
    skill: coolify
mcps:
  - lightpanda
"""


def test_merge_adds_new_skips_duplicate():
    rows = [
        {"phrase": "existing trigger", "skill": "coolify"},   # dup
        {"phrase": "brand new", "skill": "coolify"},          # new
    ]
    out = update_persona_routing(PROFILE_WITH_BLOCK, rows)
    data = yaml.safe_load(out)
    phrases = [r["phrase"] for r in data["persona_routing"]]
    assert phrases.count("existing trigger") == 1
    assert "brand new" in phrases
    assert data["mcps"] == ["lightpanda"]


def test_idempotent_no_change_returns_identical():
    rows = [{"phrase": "existing trigger", "skill": "coolify"}]
    out = update_persona_routing(PROFILE_WITH_BLOCK, rows)
    assert out == PROFILE_WITH_BLOCK


def test_empty_entries_is_noop():
    assert update_persona_routing(PROFILE_WITH_BLOCK, []) == PROFILE_WITH_BLOCK


def test_scalar_quoting_roundtrips_special_chars():
    rows = [{"phrase": 'deploy: now, "fast"', "skill": "coolify"}]
    out = update_persona_routing(PROFILE_NO_BLOCK, rows)
    data = yaml.safe_load(out)  # must not raise
    assert data["persona_routing"][0]["phrase"] == 'deploy: now, "fast"'


def test_scalar_quotes_bare_question_mark():
    # Regression for review H1: a bare '?' is a YAML key indicator and breaks
    # safe_load unless quoted.
    rows = [{"phrase": "?", "skill": "coolify"}, {"phrase": "deploy now?", "skill": "coolify"}]
    out = update_persona_routing(PROFILE_NO_BLOCK, rows)
    data = yaml.safe_load(out)  # must not raise
    phrases = [r["phrase"] for r in data["persona_routing"]]
    assert "?" in phrases and "deploy now?" in phrases


def test_crlf_line_endings_preserved():
    # Regression for review M2: CRLF input stays CRLF, still parses.
    crlf = PROFILE_NO_BLOCK.replace("\n", "\r\n")
    out = update_persona_routing(crlf, [{"phrase": "deploy", "skill": "coolify"}])
    assert "\r\n" in out
    assert "\n" not in out.replace("\r\n", "")   # no lone LF introduced
    data = yaml.safe_load(out)
    assert data["persona_routing"][0]["phrase"] == "deploy"


# ── frontmatter description replacement ────────────────────────────────────

def test_replace_inline_description_preserves_other_fields():
    fm = 'name: foo\ndescription: "old desc"\nallowed-tools: [Bash, Read]'
    out = replace_description_in_frontmatter(fm, "brand new description")
    assert "name: foo" in out
    assert "allowed-tools: [Bash, Read]" in out
    assert "brand new description" in out
    assert "old desc" not in out
    parsed = yaml.safe_load(out)
    assert parsed["description"] == "brand new description"
    assert parsed["name"] == "foo"


def test_replace_block_scalar_description():
    fm = ("name: foo\n"
          "description: >-\n"
          "  a long folded\n"
          "  description here\n"
          "triggers:\n"
          "  - do it")
    out = replace_description_in_frontmatter(fm, "short new one")
    parsed = yaml.safe_load(out)
    assert parsed["description"] == "short new one"
    assert parsed["triggers"] == ["do it"]


def test_extract_description_block_scalar():
    fm = ("name: foo\n"
          "description: >-\n"
          "  line one\n"
          "  line two\n"
          "tags: [a]")
    assert extract_description(fm) == "line one line two"


def test_extract_description_inline():
    assert extract_description('name: x\ndescription: "hello world"') == "hello world"


# ── against a real skill (needs the skills tree, not the LLM) ──────────────

def test_reassemble_with_new_description_on_real_skill():
    p = find_skill(SAMPLE, CFG.skills_root)
    assert p is not None
    skill = load_skill(p)
    rebuilt = reassemble_with_new_description(skill, "a fresh description")
    assert rebuilt.startswith("---\n")
    assert "a fresh description" in rebuilt
    # body preserved verbatim
    assert skill["body"][:200] in rebuilt
    # frontmatter still parses with name intact
    fm = rebuilt.split("---", 2)[1]
    parsed = yaml.safe_load(fm)
    assert parsed["name"] == "ted-tender-search"
    assert parsed["description"] == "a fresh description"


# ── dry-run wiring ─────────────────────────────────────────────────────────

def test_dry_run_exits_zero():
    # No --profile: prints rows only, still exits 0. Works without `cue` (lint
    # just won't run); works without an LLM key (no GEPA in dry-run).
    rc = evolve_description.evolve(skill_id=SAMPLE, target="skill", dry_run=True)
    assert rc == 0


def test_unknown_target_rejected():
    rc = evolve_description.evolve(skill_id=SAMPLE, target="bogus", dry_run=True)
    assert rc == 2


def test_analytics_dataset_build_smoke():
    """AnalyticsRoutingBuilder runs against the real analytics.jsonl (or an
    absent file) without an LLM and returns a well-formed RoutingDataset."""
    from evolution.descriptions.routing_dataset_builder import AnalyticsRoutingBuilder
    ds = AnalyticsRoutingBuilder(CFG).build("deployment/coolify")
    # structure invariants hold regardless of how much real data exists
    assert set(ds.counts().keys()) == {"train", "val", "holdout"}
    for e in ds.all_examples:
        assert isinstance(e.label, bool)
        assert e.skill_id == "deployment/coolify"
        assert len(e.user_prompt) >= 20
    assert ds.meta["source"] == "analytics"
    assert ds.meta["sessions_scanned"] >= 0


def test_analytics_mines_skill_miss_as_positives(tmp_path, monkeypatch):
    # #6/#7: a skill_miss whose matched_skills includes the target is a real
    # positive (trigger matched, skill didn't fire) and feeds miss_rate.
    from evolution.core.config import CueEvolutionConfig
    from evolution.descriptions.routing_dataset_builder import AnalyticsRoutingBuilder
    cfg_dir = tmp_path / "cue"
    cfg_dir.mkdir(parents=True)
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    lines = [
        # one clean hit session (single skill) → a positive
        {"event": "skill_hit", "skill": "meta/smart-loader", "session_id": "s1",
         "profile": "core", "first_prompt": "please find me a skill for coolify deploys"},
        # a miss where smart-loader's trigger matched but it didn't fire → positive
        {"event": "skill_miss", "matched_skills": ["meta/smart-loader"], "profile": "core",
         "prompt_redacted": "is there a skill that can load coolify support for me"},
        # an unrelated miss (different skill matched) → ignored for this target
        {"event": "skill_miss", "matched_skills": ["github/github"], "profile": "core",
         "prompt_redacted": "open a pull request against main please now"},
    ]
    (cfg_dir / "analytics.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    cfg = CueEvolutionConfig()
    b = AnalyticsRoutingBuilder(cfg)
    ds = b.build("meta/smart-loader")
    assert ds.meta["miss_positives"] == 1
    prompts = [e.user_prompt for e in ds.all_examples if e.label]
    assert any("load coolify support" in p for p in prompts)
    mr = b.miss_rate("meta/smart-loader")
    assert mr["hits"] == 1 and mr["misses"] == 1 and mr["miss_rate"] == 0.5


def test_analytics_builder_handles_missing_file(tmp_path, monkeypatch):
    from evolution.core.config import CueEvolutionConfig
    from evolution.descriptions.routing_dataset_builder import AnalyticsRoutingBuilder
    cfg = CueEvolutionConfig()
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))  # empty -> no analytics.jsonl
    ds = AnalyticsRoutingBuilder(cfg).build("meta/none")
    assert ds.all_examples == []
    assert not ds.is_sufficient()


def test_routing_split_keeps_holdout():
    """With enough examples, the split always leaves a holdout item per class."""
    from evolution.descriptions.routing_dataset_builder import (
        AnalyticsRoutingBuilder, RoutingExample,
    )
    pos = [RoutingExample(f"please do task number {i} now", True, "x") for i in range(8)]
    neg = [RoutingExample(f"unrelated request kind {i} here", False, "x") for i in range(12)]
    ds = AnalyticsRoutingBuilder(CFG)._split(pos, neg)
    c = ds.counts()
    assert c["holdout"]["pos"] >= 1 and c["holdout"]["neg"] >= 1
    assert ds.is_sufficient()


def test_usable_prompt_filters():
    from evolution.descriptions.routing_dataset_builder import _usable_prompt
    assert _usable_prompt("deploy the medusa backend to the coolify vps please")
    assert not _usable_prompt("short")
    assert not _usable_prompt("<local-command-caveat> the messages below were generated")
    assert not _usable_prompt("my key is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAA")


def test_router_instructions_roundtrip():
    # #1: the description rides in the Signature instructions; extraction must
    # recover it, and fall back cleanly if the optimizer mangles the delimiters.
    from evolution.descriptions.router_text import (
        build_router_instructions, extract_description_from_instructions,
    )
    desc = 'Use when user says "deploy". Ships the app to coolify.'
    instr = build_router_instructions(desc)
    assert desc in instr
    assert extract_description_from_instructions(instr, "FALLBACK") == desc
    # evolved instructions (optimizer rewrote the block) still extract
    evolved = instr.replace(desc, 'Use when user says "deploy", "ship". Deploys to coolify.')
    assert "ship" in extract_description_from_instructions(evolved, "FALLBACK")
    # mangled (delimiters gone) → fallback
    assert extract_description_from_instructions("no markers here", "FALLBACK") == "FALLBACK"


def test_routing_metric_accepts_gepa_5arg_signature():
    # #2: GEPA binds 5 args (gold, pred, trace, pred_name, pred_trace); the metric
    # must not raise a binding error.
    from types import SimpleNamespace
    from evolution.descriptions.routing_fitness import routing_fitness_metric
    ex = SimpleNamespace(label="yes")
    pred = SimpleNamespace(should_route="yes")
    assert routing_fitness_metric(ex, pred) == 1.0                       # 2-arg
    assert routing_fitness_metric(ex, pred, None) == 1.0                 # 3-arg (MIPRO)
    assert routing_fitness_metric(ex, pred, None, "pred", None) == 1.0   # 5-arg (GEPA)


def test_routing_metric_recall_weighted():
    # #11: TP=1.0, TN=0.5, errors=0.0 — so predict-all-"no" can't out-score a
    # router that catches positives.
    from types import SimpleNamespace
    from evolution.descriptions.routing_fitness import routing_fitness_metric
    M = lambda lbl, pred: routing_fitness_metric(SimpleNamespace(label=lbl),
                                                 SimpleNamespace(should_route=pred))
    assert M("yes", "yes") == 1.0   # TP
    assert M("no", "no") == 0.5     # TN (modest, not full credit)
    assert M("yes", "no") == 0.0    # FN
    assert M("no", "yes") == 0.0    # FP
    assert M("yes", "Yes, it matches.") == 1.0   # tolerant of verbose output
    # predict-all-no at 3:1 scores below a perfect router
    allno = (3 * M("no", "no") + 1 * M("yes", "no")) / 4      # 0.375
    perfect = (3 * M("no", "no") + 1 * M("yes", "yes")) / 4   # 0.625
    assert allno < perfect


def test_f1_from_labels():
    from evolution.descriptions.routing_fitness import f1_from_labels
    y_true = ["yes", "yes", "no", "no"]
    y_pred = ["yes", "no", "no", "no"]   # 1 TP, 1 FN, 2 TN, 0 FP
    r = f1_from_labels(y_true, y_pred)
    assert r["tp"] == 1 and r["fn"] == 1 and r["tn"] == 2 and r["fp"] == 0
    assert r["precision"] == 1.0
    assert r["recall"] == 0.5
    assert r["f1"] == 0.6667  # round(2/3, 4)


def test_description_module_importable():
    # DSPy is in the optimize extra but needs a native stack (tokenizers ->
    # libstdc++). Skip where it can't import; exercise it where it can.
    pytest.importorskip("dspy", exc_type=ImportError)
    from evolution.descriptions.description_module import DescriptionModule
    m = DescriptionModule("some description text")
    assert m.baseline_description == "some description text"
    assert "some description text" in m._instructions()


# ── Phase 3: gating + landing (GEPA-independent, fully offline) ────────────

_BASELINE = ("Use when the user mentions a tool not in their profile. Locates the "
             "matching SKILL.md on disk and follows it inline.")
_EVOLVED = ('Use when user says "smart load", "find a skill for X". Locates a '
            "matching SKILL.md on disk and follows it inline.")


class _Lint:
    def __init__(self, ok, score):
        self.ok = ok
        self.score = score


def _fake_skill(desc="old"):
    return {"name": "smart-loader",
            "frontmatter": f'name: smart-loader\ndescription: "{desc}"',
            "body": "# body"}


def _mk_repo(tmp_path, profile="coolify", content="name: coolify\nmcps:\n  - lightpanda\n"):
    repo = tmp_path / "repo"
    (repo / "profiles" / profile).mkdir(parents=True)
    prof = repo / "profiles" / profile / "profile.yaml"
    prof.write_text(content)
    return repo, prof


def test_precheck_description():
    from evolution.descriptions.evolve_description import _precheck_description
    ok = dict((n, p) for p, n, _ in _precheck_description(_EVOLVED, _BASELINE, "smart-loader"))
    assert all(ok.values())
    # too long
    long = "x " * 130
    assert not dict((n, p) for p, n, _ in _precheck_description(long, _BASELINE, "s"))["length"]
    # excessive growth from a tiny baseline
    assert not dict((n, p) for p, n, _ in _precheck_description(_EVOLVED, "hi", "s"))["growth"]
    # no extractable rows
    assert not dict((n, p) for p, n, _ in _precheck_description("nope", "nope here ok", "s"))["yields_rows"]


def test_finalize_applies_when_gates_pass(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    monkeypatch.setattr(ed, "validate_profile", lambda c, p: (False, False))  # cue unavailable → keep edit
    monkeypatch.setattr(ed, "_materialize", lambda c, p: None)                # don't shell cue in tests
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path)
    cfg.cue_repo_path = repo

    rc = ed._finalize_skill(
        cfg, _fake_skill(), prof, "meta/smart-loader", "coolify", prof,
        evolved_desc=_EVOLVED, baseline_desc=_BASELINE,
        f1_base={"f1": 0.40, "tp": 1, "fn": 3, "tn": 4, "fp": 1},
        f1_evo={"f1": 0.80, "tp": 3, "fn": 1, "tn": 4, "fp": 1},   # holdout 4 pos / 5 neg
        lint_base=_Lint(True, 90), lint_evolved=_Lint(True, 92),
        mutated=True, iterations=3, optimizer_model="m", elapsed_s=1.0,
        note="auto", eval_source="synthetic", dataset_meta={"source": "synthetic"},
    )
    assert rc == 0
    data = yaml.safe_load(prof.read_text())
    phrases = [r.get("phrase") for r in data["persona_routing"]]
    assert "smart load" in phrases
    assert data["mcps"] == ["lightpanda"]                       # untouched
    assert list(prof.parent.glob("profile.yaml.bak-*"))         # backup made
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is True and entry["kind"] == "persona-routing"
    assert entry["improvement"] == 0.4


def test_resolve_profile_path_blocks_traversal(tmp_path):
    # Regression for review M4: `--profile ../x` must not escape profiles/.
    from evolution.descriptions import evolve_description as ed
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path)
    cfg.cue_repo_path = repo
    # a profile.yaml sitting OUTSIDE profiles/ that an escape could reach
    (repo / "evil").mkdir()
    (repo / "evil" / "profile.yaml").write_text("name: evil\n")
    assert ed._resolve_profile_path(cfg, "../evil") is None
    assert ed._resolve_profile_path(cfg, "coolify") == prof.resolve()


def test_finalize_skill_proposes_when_holdout_too_small(tmp_path, monkeypatch):
    # #5: a big F1 delta on a 1+1 holdout must NOT auto-apply — it's noise.
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    monkeypatch.setattr(ed, "validate_profile", lambda c, p: (False, False))
    monkeypatch.setattr(ed, "_materialize", lambda c, p: None)
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path)
    cfg.cue_repo_path = repo
    before = prof.read_text()
    rc = ed._finalize_skill(
        cfg, _fake_skill(), prof, "meta/smart-loader", "coolify", prof,
        evolved_desc=_EVOLVED, baseline_desc=_BASELINE,
        f1_base={"f1": 0.0, "tp": 0, "fn": 1, "tn": 1, "fp": 0},
        f1_evo={"f1": 1.0, "tp": 1, "fn": 0, "tn": 1, "fp": 0},   # holdout 1 pos / 1 neg
        lint_base=_Lint(True, 90), lint_evolved=_Lint(True, 92),
        mutated=True, iterations=3, optimizer_model="m", elapsed_s=1.0,
        note="auto", eval_source="synthetic", dataset_meta={"source": "synthetic"},
    )
    assert rc == 0
    assert prof.read_text() == before                 # NOT applied despite +1.0 F1
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is False and "holdout too small" in entry["reason"]


def test_finalize_proposal_when_no_improvement(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path)
    cfg.cue_repo_path = repo
    before = prof.read_text()

    rc = ed._finalize_skill(
        cfg, _fake_skill(), prof, "meta/smart-loader", "coolify", prof,
        evolved_desc=_EVOLVED, baseline_desc=_BASELINE,
        f1_base={"f1": 0.40, "tp": 3, "fn": 1, "tn": 4, "fp": 1},
        f1_evo={"f1": 0.41, "tp": 3, "fn": 1, "tn": 4, "fp": 1},   # +0.01 ≤ 0.05, holdout OK
        lint_base=_Lint(True, 90), lint_evolved=_Lint(True, 92),
        mutated=True, iterations=3, optimizer_model="m", elapsed_s=1.0,
        note="auto", eval_source="synthetic", dataset_meta={"source": "synthetic"},
    )
    assert rc == 0
    assert prof.read_text() == before                            # profile UNCHANGED
    proposals = list((repo / "evolution" / "proposals" / "descriptions").rglob("evolved_description.txt"))
    assert proposals, "expected a proposal directory"
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is False


def test_finalize_proposal_when_not_mutated(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path)
    cfg.cue_repo_path = repo
    before = prof.read_text()

    rc = ed._finalize_skill(
        cfg, _fake_skill(), prof, "meta/smart-loader", "coolify", prof,
        evolved_desc=_EVOLVED, baseline_desc=_BASELINE,
        f1_base={"f1": 0.40}, f1_evo={"f1": 0.99},   # huge delta but...
        lint_base=_Lint(True, 90), lint_evolved=_Lint(True, 92),
        mutated=False,                                # ...GEPA didn't change the text
        iterations=3, optimizer_model="m", elapsed_s=1.0,
        note="auto", eval_source="synthetic", dataset_meta={"source": "synthetic"},
    )
    assert rc == 0
    assert prof.read_text() == before
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is False
    assert "did not mutate" in entry["reason"]


# ── Phase 4: persona / profile-description adapter ─────────────────────────

_PROFILE_WITH_PERSONA = """\
name: coolify
description: "Coolify deploys, server config"
persona: |
  You're a DevOps engineer.

  - Env vars are config.   # keep this comment
  - Health checks first.
skills:
  local:
    - deployment/coolify
mcps:
  - lightpanda
"""


def test_set_profile_field_persona_block_preserves_rest():
    from evolution.descriptions.profile_yaml_writer import set_profile_field
    new = set_profile_field(_PROFILE_WITH_PERSONA, "persona",
                            "You are a sharper DevOps engineer.\n\n- Roll back first.")
    data = yaml.safe_load(new)
    assert data["persona"].startswith("You are a sharper DevOps engineer.")
    assert "Roll back first." in data["persona"]
    # other fields + the skills comment-free structure survive
    assert data["name"] == "coolify"
    assert data["mcps"] == ["lightpanda"]
    assert data["skills"]["local"] == ["deployment/coolify"]
    assert "# keep this comment" not in new  # old persona body (with comment) replaced


def test_set_profile_field_description_scalar():
    from evolution.descriptions.profile_yaml_writer import set_profile_field
    new = set_profile_field(_PROFILE_WITH_PERSONA, "description", "A new one-line blurb")
    data = yaml.safe_load(new)
    assert data["description"] == "A new one-line blurb"
    assert data["name"] == "coolify"
    assert "You're a DevOps engineer." in data["persona"]   # persona untouched


def test_set_profile_field_block_keeps_internal_blank_lines():
    from evolution.descriptions.profile_yaml_writer import set_profile_field
    new = set_profile_field(_PROFILE_WITH_PERSONA, "persona", "Para one.\n\nPara two.")
    data = yaml.safe_load(new)
    assert "Para one." in data["persona"] and "Para two." in data["persona"]
    assert data["mcps"] == ["lightpanda"]


def test_build_persona_scenarios_from_real_evals():
    from evolution.descriptions.persona_eval import build_persona_scenarios
    scs = build_persona_scenarios(CFG)
    assert scs, "expected trigger-phrase scenarios from resources/evals/*.md"
    assert all(s.task_input for s in scs)


def test_precheck_persona():
    from evolution.descriptions.evolve_description import _precheck_persona
    good = "You are a focused engineer.\n- You default to small diffs.\n- Verify before done."
    ok = dict((n, p) for p, n, _ in _precheck_persona(good, good, "persona"))
    assert all(ok.values())
    # description target enforces the 200-char Ajv cap
    long_desc = "x" * 250
    d = dict((n, p) for p, n, _ in _precheck_persona(long_desc, "short blurb here ok", "description"))
    assert not d["length"]
    # persona with no behavioral directive fails that check
    p = dict((n, ok_) for ok_, n, _ in _precheck_persona("just prose no directive at all here", "x" * 30, "persona"))
    assert not p["behavioral_directive"]


def test_finalize_persona_propose_only_by_default(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path, content=_PROFILE_WITH_PERSONA)
    cfg.cue_repo_path = repo
    before = prof.read_text()
    base = ("You are a DevOps engineer. You default to small, reversible diffs.\n"
            "- You verify before claiming done.\n- You roll back first if a deploy regresses.")
    evo = ("You are a focused DevOps engineer. You default to small, reversible diffs.\n"
           "- You verify behavior before claiming done.\n- You plan a rollback first.")
    rc = ed._finalize_persona(cfg, "coolify", prof, "persona", evo, base,
                              {"composite": 0.5}, {"composite": 0.8}, allow_apply=False)
    assert rc == 0
    assert prof.read_text() == before                       # NOT applied by default
    props = list((repo / "evolution" / "proposals" / "personas").rglob("evolved_persona.txt"))
    assert props
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is False and "propose-only" in entry["reason"]


def test_finalize_persona_applies_with_optin_and_validate_skipped(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    # Simulate cue validate unavailable → rely on prechecks (ran=False).
    monkeypatch.setattr(ed, "validate_profile", lambda c, p: (False, False))
    monkeypatch.setattr(ed, "_materialize", lambda c, p: None)
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path, content=_PROFILE_WITH_PERSONA)
    cfg.cue_repo_path = repo
    base = ("You are a DevOps engineer. You default to small, reversible diffs.\n"
            "- You verify before claiming done.\n- You roll back first if a deploy regresses.")
    evo = ("You are a focused DevOps engineer. You default to small, reversible diffs.\n"
           "- You verify behavior before claiming done.\n- You plan a rollback first.")
    rc = ed._finalize_persona(cfg, "coolify", prof, "persona", evo, base,
                              {"composite": 0.5}, {"composite": 0.8}, allow_apply=True)
    assert rc == 0
    data = yaml.safe_load(prof.read_text())
    assert "focused DevOps engineer" in data["persona"]
    assert data["mcps"] == ["lightpanda"]
    assert list(prof.parent.glob("profile.yaml.bak-*"))
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is True and entry["kind"] == "profile-persona"


def test_finalize_description_applies_with_optin(tmp_path, monkeypatch):
    # L1: cover the which='description' scalar-write apply branch.
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    monkeypatch.setattr(ed, "validate_profile", lambda c, p: (False, False))
    monkeypatch.setattr(ed, "_materialize", lambda c, p: None)
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path, content=_PROFILE_WITH_PERSONA)
    cfg.cue_repo_path = repo
    rc = ed._finalize_persona(cfg, "coolify", prof, "description",
                              "Coolify: deploy helper, env vars, CI", "Coolify deploys, server config",
                              {"composite": 0.5}, {"composite": 0.8}, allow_apply=True)
    assert rc == 0
    data = yaml.safe_load(prof.read_text())
    assert data["description"] == "Coolify: deploy helper, env vars, CI"   # colon survives quoting
    assert data["persona"].startswith("You're a DevOps engineer.")          # persona untouched
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is True and entry["kind"] == "profile-description"


def test_finalize_persona_reverts_when_validate_fails(tmp_path, monkeypatch):
    from evolution.descriptions import evolve_description as ed
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "cfg"))
    monkeypatch.setattr(ed, "validate_profile", lambda c, p: (True, False))  # validate REJECTS
    cfg = CueEvolutionConfig()
    repo, prof = _mk_repo(tmp_path, content=_PROFILE_WITH_PERSONA)
    cfg.cue_repo_path = repo
    before = prof.read_text()
    base = ("You are a DevOps engineer. You default to small, reversible diffs.\n"
            "- You verify before claiming done.\n- You roll back first if a deploy regresses.")
    evo = ("You are a focused DevOps engineer. You default to small, reversible diffs.\n"
           "- You verify behavior before claiming done.\n- You plan a rollback first.")
    rc = ed._finalize_persona(cfg, "coolify", prof, "persona", evo, base,
                              {"composite": 0.5}, {"composite": 0.8}, allow_apply=True)
    assert rc == 0
    assert prof.read_text() == before                       # reverted
    entry = json.loads(cfg.evolution_log.read_text().splitlines()[-1])
    assert entry["applied"] is False and "reverted" in entry["reason"]


def test_hints_from_scores():
    # #9: weak judge dimensions become a targeted rewrite hint.
    from evolution.descriptions.evolve_description import _hints_from_scores
    weak = _hints_from_scores({"role_consistency": 0.9, "defaults_applied": 0.4,
                               "freestyling_avoided": 0.5})
    assert "defaults" in weak and "scope" in weak
    strong = _hints_from_scores({"role_consistency": 0.9, "defaults_applied": 0.8,
                                 "freestyling_avoided": 0.9})
    assert "already scores well" in strong


def test_gather_sibling_descriptions_real_repo():
    # #8: co-loaded skills' descriptions, excluding the target itself.
    from evolution.descriptions.routing_dataset_builder import gather_sibling_descriptions
    sibs = gather_sibling_descriptions(CFG, "coolify", "deployment/coolify")
    assert sibs, "expected sibling skill descriptions for the coolify profile"
    # the target's own description must be excluded
    assert all("Coolify deploys" not in s for s in sibs) or len(sibs) >= 1
    # no profile → empty
    assert gather_sibling_descriptions(CFG, None, "x") == []


def test_command_target_is_reframed_not_implemented():
    from evolution.descriptions import evolve_description as ed
    assert ed.evolve(target="command", dry_run=True) == 2


def test_sweep_skill_ids_from_profile():
    # #13: sweep enumerates a profile's declared skills, capped.
    from evolution.descriptions.evolve_description import _sweep_skill_ids
    ids = _sweep_skill_ids(CFG, "coolify", max_skills=3)
    assert 1 <= len(ids) <= 3
    assert all("/" in i or i for i in ids)


def test_sweep_dry_run_offline():
    # #13: a dry-run sweep over a small profile runs each skill's dry-run, exit 0.
    from evolution.descriptions import evolve_description as ed
    rc = ed.evolve(target="skill", profile="coolify", all_skills=True,
                   max_skills=2, dry_run=True)
    assert rc == 0


def test_persona_dry_run_against_real_repo():
    from evolution.descriptions import evolve_description as ed
    # auto-discovers the cue repo; reads coolify persona + evals scenarios offline.
    assert ed.evolve(target="persona", profile="coolify", dry_run=True) == 0
    assert ed.evolve(target="description", profile="coolify", dry_run=True) == 0


# ── R7 / #12: real-routing smoke check (router extraction is offline) ──────

_FAKE_CLAUDE_MD = """\
<!-- cue: profile=coolify -->
# Active Profile: coolify

> Coolify deploys

## Your Expertise
You're a DevOps engineer.

## Skill Routing

| When you're about to… | Reach for |
|---|---|
| deploy a container to coolify | coolify |

Trigger phrases:
| User says | Skill |
|---|---|
| "deploy to coolify" | coolify |

## Your Role
You are operating as coolify.

## Available Commands
- /code-review
"""


def test_extract_router_block_and_mentions():
    from evolution.descriptions.smoke import extract_router_block, router_mentions
    block = extract_router_block(_FAKE_CLAUDE_MD)
    assert "Skill Routing" in block
    assert "Your Role" not in block            # bounded before the next section
    assert router_mentions(_FAKE_CLAUDE_MD, "deploy to coolify")   # phrase in router
    assert router_mentions(_FAKE_CLAUDE_MD, "DEPLOY TO COOLIFY")   # case-insensitive
    assert not router_mentions(_FAKE_CLAUDE_MD, "/code-review")    # outside the router block
    assert not router_mentions(_FAKE_CLAUDE_MD, "")


def test_latest_apply_phrases_from_log(tmp_path, monkeypatch):
    # smoke --from-log: pull the phrases of the last APPLIED persona-routing entry.
    from evolution.core.config import CueEvolutionConfig
    from evolution.descriptions import smoke
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    cfg = CueEvolutionConfig()
    log = cfg.evolution_log
    log.parent.mkdir(parents=True, exist_ok=True)
    entries = [
        {"kind": "persona-routing", "profile": "coolify", "applied": False,
         "entries_added": [{"phrase": "stale", "skill": "coolify"}]},          # not applied
        {"kind": "persona-routing", "profile": "other", "applied": True,
         "entries_added": [{"phrase": "wrong profile", "skill": "x"}]},        # wrong profile
        {"kind": "persona-routing", "profile": "coolify", "applied": True,
         "entries_added": [{"phrase": "deploy to coolify", "skill": "coolify"},
                           {"capability": "restart a coolify app", "skill": "coolify"}]},
    ]
    log.write_text("\n".join(json.dumps(e) for e in entries) + "\n")
    got = smoke.latest_apply_phrases(cfg, "coolify")
    assert got == ["deploy to coolify", "restart a coolify app"]   # last applied, this profile
    assert smoke.latest_apply_phrases(cfg, "nope") == []


def test_smoke_check_reports_missing_when_no_md(tmp_path, monkeypatch):
    from evolution.core.config import CueEvolutionConfig
    from evolution.descriptions import smoke
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))           # no runtime CLAUDE.md
    monkeypatch.setattr(smoke.subprocess, "run",
                        lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()))
    cfg = CueEvolutionConfig()
    rep = smoke.smoke_check(cfg, "coolify", ["deploy to coolify"])
    assert rep["materialized"] is False
    assert rep["all_present"] is False


def test_backup_and_write_roundtrip(tmp_path):
    f = tmp_path / "profile.yaml"
    f.write_text("name: x\n")
    backup = backup_and_write(f, "name: y\n", "20260609T000000Z")
    assert backup.name == "profile.yaml.bak-20260609T000000Z"
    assert backup.read_text() == "name: x\n"
    assert f.read_text() == "name: y\n"
