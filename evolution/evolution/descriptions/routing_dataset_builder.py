"""Build the routing-evaluation dataset for a description.

A skill description's *job* is routing: make Claude reach for the skill at the
right moment and not otherwise. So the fitness signal is routing accuracy on
labeled (user_prompt -> should_fire?) pairs.

Two sources, with a fallback:
  * analytics — real `first_prompt`s from ~/.config/cue/analytics.jsonl
    (positives = sessions where this skill fired AND ≤N skills co-fired;
    negatives = sessions where it didn't, preferring same-category "hard"
    negatives). NOTE: `skill_hit` fires for EVERY skill in a profile's CLAUDE.md,
    so most sessions co-fire many skills and are dropped by the co-occurrence
    filter — that is intentional; thin real signal falls back to synthetic.
  * synthetic — an LLM reads the description and invents positives (prompts that
    SHOULD route here) + distractors (plausible prompts that should NOT).

`build_routing_dataset()` tries analytics first and falls back to synthetic when
fewer than MIN_REAL_POSITIVES clean positives exist.

DSPy is imported lazily (only the synthetic builder + to_dspy_examples need it),
so the analytics path and `--dry-run --eval-source analytics` run with no key.
"""

from __future__ import annotations

import json
import random
import re
from pathlib import Path
from dataclasses import dataclass, field
from collections import defaultdict
from typing import Optional

import yaml

from evolution.core.config import CueEvolutionConfig
from evolution.core.redact import contains_secret
from evolution.core.cue_skill import find_skill, load_skill, extract_description

# Tail-of-transcript / slash-command preamble that is NOT a user utterance.
_NOISY_MARKERS = (
    "<local-command-caveat>",
    "<command-message>",
    "<command-name>",
    "<command-args>",
    "<command-stdout>",
    "<system-reminder>",
    "caveat: the messages below",
    "this session is being continued",
)
_MIN_PROMPT_LEN = 20
_MIN_REAL_POSITIVES = 3
_SPLIT_SEED = 1789  # fixed so dataset construction is reproducible/testable


# ── data model ─────────────────────────────────────────────────────────────

@dataclass
class RoutingExample:
    user_prompt: str
    label: bool                     # True = this skill should fire
    skill_id: str
    profile: Optional[str] = None
    source: str = "analytics"       # 'analytics' | 'synthetic'
    co_occurrence_count: int = 1

    def to_dict(self) -> dict:
        return {
            "user_prompt": self.user_prompt,
            "label": self.label,
            "skill_id": self.skill_id,
            "profile": self.profile,
            "source": self.source,
            "co_occurrence_count": self.co_occurrence_count,
        }


@dataclass
class RoutingDataset:
    train: list = field(default_factory=list)
    val: list = field(default_factory=list)
    holdout: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    @property
    def all_examples(self) -> list:
        return self.train + self.val + self.holdout

    def counts(self) -> dict:
        def pn(split):
            pos = sum(1 for e in split if e.label)
            return {"pos": pos, "neg": len(split) - pos}
        return {"train": pn(self.train), "val": pn(self.val), "holdout": pn(self.holdout)}

    def is_sufficient(self) -> bool:
        """A meaningful holdout comparison needs at least 1 positive and 1
        negative held out, and a non-empty trainset."""
        c = self.counts()
        return bool(self.train) and c["holdout"]["pos"] >= 1 and c["holdout"]["neg"] >= 1

    def to_dspy_examples(self, split: str) -> list:
        import dspy  # lazy: only the real GEPA path needs DSPy
        data = getattr(self, split)
        return [
            dspy.Example(user_prompt=e.user_prompt, label="yes" if e.label else "no")
            .with_inputs("user_prompt")
            for e in data
        ]


# ── analytics source ─────────────────────────────────────────────────────

def _usable_prompt(prompt: str) -> bool:
    if not prompt:
        return False
    p = prompt.strip()
    if len(p) < _MIN_PROMPT_LEN:
        return False
    low = p.lower()
    if any(m in low for m in _NOISY_MARKERS):
        return False
    if contains_secret(p):
        return False
    return True


def _norm(prompt: str) -> str:
    return re.sub(r"\s+", " ", prompt.strip().lower())[:200]


def _dedup(examples: list) -> list:
    seen: set = set()
    out = []
    for e in examples:
        k = _norm(e.user_prompt)
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


def _category(skill_id: str) -> str:
    return skill_id.split("/")[0] if "/" in skill_id else ""


class AnalyticsRoutingBuilder:
    """Mine routing examples from analytics.jsonl `skill_hit` events."""

    def __init__(self, config: CueEvolutionConfig,
                 cooccurrence_threshold: int = 3, neg_ratio: int = 3):
        self.config = config
        self.cooccurrence_threshold = cooccurrence_threshold
        self.neg_ratio = neg_ratio

    def _read_sessions(self):
        """-> (session_skills, session_prompt, session_profile)."""
        session_skills: dict[str, set] = defaultdict(set)
        session_prompt: dict[str, str] = {}
        session_profile: dict[str, Optional[str]] = {}
        # skill_miss = a trigger matched but the skill was NOT invoked → a real
        # prompt the routing SHOULD have caught. Ground-truth positives.
        misses: list[dict] = []
        path = self.config.analytics_log
        if not path.exists():
            return session_skills, session_prompt, session_profile, misses
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or ('"skill_hit"' not in line and '"skill_miss"' not in line):
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev = d.get("event")
                if ev == "skill_hit":
                    sid = d.get("session_id")
                    skill = d.get("skill")
                    if not sid or not skill:
                        continue
                    session_skills[sid].add(skill)
                    session_profile.setdefault(sid, d.get("profile"))
                    fp = d.get("first_prompt")
                    if fp and sid not in session_prompt:
                        session_prompt[sid] = fp
                elif ev == "skill_miss":
                    misses.append({
                        "prompt": d.get("prompt_redacted") or d.get("first_prompt") or "",
                        "matched_skills": d.get("matched_skills") or [],
                        "profile": d.get("profile"),
                    })
        return session_skills, session_prompt, session_profile, misses

    def _miss_is_target(self, miss: dict, target: str, slug: str) -> bool:
        matched = miss.get("matched_skills") or []
        return (target in matched) or any(str(s).split("/")[-1] == slug for s in matched)

    def miss_rate(self, canonical_id: str, profile: Optional[str] = None) -> dict:
        """Real-behavior signal: misses / (hits + misses) for this skill. A high
        rate means real prompts matched the trigger but didn't route — exactly
        what an evolved description should reduce. Loggable pre/post apply."""
        session_skills, _, session_profile, misses = self._read_sessions()
        slug = canonical_id.split("/")[-1]
        hits = sum(
            1 for sid, skills in session_skills.items()
            if (not profile or session_profile.get(sid) == profile)
            and ((canonical_id in skills) or any(s.split("/")[-1] == slug for s in skills))
        )
        miss_n = sum(
            1 for m in misses
            if (not profile or m.get("profile") == profile)
            and self._miss_is_target(m, canonical_id, slug)
        )
        total = hits + miss_n
        return {"hits": hits, "misses": miss_n,
                "miss_rate": round(miss_n / total, 4) if total else 0.0}

    def build(self, canonical_id: str, profile: Optional[str] = None) -> RoutingDataset:
        session_skills, session_prompt, session_profile, misses = self._read_sessions()

        target = canonical_id
        slug = canonical_id.split("/")[-1]
        cat = _category(canonical_id)

        positives: list[RoutingExample] = []
        hard_neg: list[RoutingExample] = []
        soft_neg: list[RoutingExample] = []

        for sid, skills in session_skills.items():
            prompt = session_prompt.get(sid, "")
            prof = session_profile.get(sid)
            if profile and prof != profile:
                continue
            if not _usable_prompt(prompt):
                continue
            in_session = (target in skills) or any(s.split("/")[-1] == slug for s in skills)
            if in_session:
                co = len(skills)
                if co <= self.cooccurrence_threshold:
                    positives.append(RoutingExample(prompt, True, canonical_id, prof,
                                                    "analytics", co))
            else:
                ex = RoutingExample(prompt, False, canonical_id, prof, "analytics", len(skills))
                same_cat = bool(cat) and any(_category(s) == cat for s in skills)
                (hard_neg if same_cat else soft_neg).append(ex)

        # skill_miss prompts where THIS skill's trigger matched but it didn't fire
        # are the strongest real positives — the description must catch these.
        # Approximation: a miss can also mean the user *declined* the skill (not
        # just a vague description). The log can't distinguish the two, so a
        # systematic-dismissal skill could get a few low-quality positives; the
        # _usable_prompt + dedup guards bound the damage and misses are rare.
        miss_positives = 0
        for m in misses:
            if profile and m.get("profile") != profile:
                continue
            p = m.get("prompt", "")
            if not _usable_prompt(p):
                continue
            if self._miss_is_target(m, target, slug):
                positives.append(RoutingExample(p, True, canonical_id, m.get("profile"),
                                                "analytics-miss", 1))
                miss_positives += 1

        positives = _dedup(positives)
        # Hard negatives (same category) first — they force the description to
        # discriminate within its neighbourhood, not just against random noise.
        negatives = _dedup(hard_neg) + _dedup(soft_neg)
        cap = max(1, len(positives) * self.neg_ratio) if positives else 0
        negatives = negatives[:cap]

        ds = self._split(positives, negatives)
        ds.meta.update({
            "source": "analytics",
            "skill": canonical_id,
            "profile": profile,
            "cooccurrence_threshold": self.cooccurrence_threshold,
            "raw_positives": len(positives),
            "miss_positives": miss_positives,
            "raw_negatives_available": len(hard_neg) + len(soft_neg),
            "hard_negatives": len(_dedup(hard_neg)),
            "sessions_scanned": len(session_skills),
        })
        return ds

    def _split(self, positives: list, negatives: list) -> RoutingDataset:
        rng = random.Random(_SPLIT_SEED)
        rng.shuffle(positives)
        rng.shuffle(negatives)

        def split3(items):
            n = len(items)
            if n == 0:
                return [], [], []
            n_tr = max(1, int(n * 0.5))
            n_va = max(0, int(n * 0.25))
            # ensure a holdout item exists when n>=2
            if n >= 2 and n_tr + n_va >= n:
                n_va = max(0, n - n_tr - 1)
            return items[:n_tr], items[n_tr:n_tr + n_va], items[n_tr + n_va:]

        p_tr, p_va, p_ho = split3(positives)
        n_tr, n_va, n_ho = split3(negatives)
        return RoutingDataset(
            train=p_tr + n_tr, val=p_va + n_va, holdout=p_ho + n_ho,
        )


def gather_sibling_descriptions(config: CueEvolutionConfig, profile: Optional[str],
                                exclude_canonical: str, limit: int = 8) -> list[str]:
    """Descriptions of the OTHER skills co-loaded in `profile` — the near-neighbours
    a hard negative must resemble. Offline (reads profile.yaml + SKILL.md
    frontmatter); empty when no profile is given."""
    if not profile:
        return []
    ppath = config.profiles_root / profile / "profile.yaml"
    if not ppath.is_file():
        return []
    try:
        data = yaml.safe_load(ppath.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return []
    skills = data.get("skills") or {}
    local = skills.get("local", []) if isinstance(skills, dict) else []
    excl_slug = exclude_canonical.split("/")[-1]
    out: list[str] = []
    for s in local:
        sid = s.get("id", "") if isinstance(s, dict) else str(s)
        if not sid or sid.split("/")[-1] == excl_slug:
            continue
        p = find_skill(sid, config.skills_root)
        if not p:
            continue
        try:
            sk = load_skill(p)
        except OSError:
            continue
        d = extract_description(sk["frontmatter"]) or sk.get("description", "")
        if d:
            out.append(d[:160])
        if len(out) >= limit:
            break
    return out


# ── synthetic source (lazy DSPy) ──────────────────────────────────────────

class SyntheticRoutingBuilder:
    """Generate routing examples from the description text with an LLM.

    Reuses SyntheticDatasetBuilder (artifact_type='tool_description') for
    positives, and a small distractor signature for hard negatives. DSPy is
    imported lazily so this module stays offline-importable.
    """

    def __init__(self, config: CueEvolutionConfig):
        self.config = config

    def build(self, description_text: str, canonical_id: str,
              n_pos: int = 12, n_neg: int = 18,
              sibling_descriptions: Optional[list[str]] = None) -> RoutingDataset:
        import dspy
        from evolution.core.dataset_builder import SyntheticDatasetBuilder

        # Positives: prompts that SHOULD route here.
        builder = SyntheticDatasetBuilder(self.config)
        pos_ds = builder.generate(
            artifact_text=description_text, artifact_type="tool_description",
            num_cases=n_pos,
        )
        positives = [
            RoutingExample(ex.task_input, True, canonical_id, None, "synthetic")
            for ex in pos_ds.all_examples
        ]

        # Negatives: plausible-but-different prompts that should NOT route here.
        # When co-loaded sibling skills are supplied, generate prompts that belong
        # to THOSE neighbours — true near-misses, not off-domain noise.
        siblings = [s for s in (sibling_descriptions or []) if s]
        hard = bool(siblings)

        class GenerateDistractors(dspy.Signature):
            """Write realistic user prompts that are PLAUSIBLE but should NOT
            trigger the TARGET skill. If neighbour skills are listed, write
            prompts that clearly belong to those NEIGHBOURS instead — adjacent
            tasks a user might confuse with the target (true near-misses).
            Return a JSON array of prompt strings."""
            description: str = dspy.InputField(desc="The TARGET skill's description")
            neighbour_skills: str = dspy.InputField(desc="Co-loaded sibling skill descriptions; may be '(none)'")
            num: int = dspy.InputField(desc="How many distractor prompts")
            prompts: str = dspy.OutputField(desc="JSON array of user-prompt strings")

        gen = dspy.ChainOfThought(GenerateDistractors)
        lm = dspy.LM(self.config.judge_model, **self.config.lm_kwargs())
        negatives: list[RoutingExample] = []
        try:
            with dspy.context(lm=lm):
                out = gen(
                    description=description_text,
                    neighbour_skills="\n".join(f"- {s}" for s in siblings) or "(none)",
                    num=n_neg,
                )
            raw = out.prompts
            try:
                arr = json.loads(raw)
            except json.JSONDecodeError:
                m = re.search(r"\[.*\]", raw, re.DOTALL)
                arr = json.loads(m.group()) if m else []
            src = "synthetic-hard" if hard else "synthetic"
            for p in arr:
                if isinstance(p, str) and _usable_prompt(p):
                    negatives.append(RoutingExample(p, False, canonical_id, None, src))
        except Exception:
            pass  # negatives are best-effort; positives alone still train routing

        ab = AnalyticsRoutingBuilder(self.config)
        ds = ab._split(_dedup(positives), _dedup(negatives))
        ds.meta.update({"source": "synthetic", "skill": canonical_id,
                        "synth_positives": len(positives), "synth_negatives": len(negatives),
                        "hard_negatives": len(negatives) if hard else 0,
                        "siblings_used": len(siblings)})
        return ds


# ── orchestrator ───────────────────────────────────────────────────────────

def build_routing_dataset(
    canonical_id: str,
    description_text: str,
    config: CueEvolutionConfig,
    profile: Optional[str] = None,
    eval_source: str = "synthetic",
) -> RoutingDataset:
    """analytics-first (when requested) with synthetic fallback. Synthetic
    negatives are hardened with the profile's co-loaded skill descriptions."""
    siblings = gather_sibling_descriptions(config, profile, canonical_id)
    if eval_source == "analytics":
        ds = AnalyticsRoutingBuilder(config).build(canonical_id, profile)
        n_pos = sum(1 for e in ds.all_examples if e.label)
        if n_pos >= _MIN_REAL_POSITIVES and ds.is_sufficient():
            return ds
        # Fall back, but carry forward why for the log/proposal.
        fallback = SyntheticRoutingBuilder(config).build(
            description_text, canonical_id, sibling_descriptions=siblings)
        fallback.meta["source"] = "analytics->synthetic-fallback"
        fallback.meta["analytics_positives"] = n_pos
        return fallback

    return SyntheticRoutingBuilder(config).build(
        description_text, canonical_id, sibling_descriptions=siblings)
