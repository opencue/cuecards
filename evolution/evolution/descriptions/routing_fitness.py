"""Routing-accuracy fitness for description evolution.

A description's job is routing, so the metric is: does the router (driven by the
candidate description) label each prompt correctly? This is a far stronger signal
than the body engine's keyword-overlap proxy — the label is ground truth
(`yes`/`no`), not vocabulary overlap.

Two pieces:
  * routing_fitness_metric — per-example 0/1, the metric handed to dspy.GEPA.
  * routing_f1_on_holdout  — positive-class F1 over the blind holdout, the gate
    that decides apply-vs-proposal.

No DSPy import at module top, so the metric + the pure F1 helper are unit-tested
without a key. routing_f1_on_holdout only *calls* an already-built module.
"""

from __future__ import annotations

from typing import Iterable


def _norm_label(value) -> str:
    s = str(value).strip().lower()
    if s in ("yes", "true", "1", "y"):
        return "yes"
    if s in ("no", "false", "0", "n"):
        return "no"
    # Tolerate a sentence; look for a leading yes/no.
    if s.startswith("yes"):
        return "yes"
    if s.startswith("no"):
        return "no"
    return "no"  # fail safe: ambiguous output counts as "do not route"


def routing_fitness_metric(example, prediction, trace=None, *args, **kwargs) -> float:
    """DSPy-compatible per-example routing reward, recall-weighted to align the
    summed metric with positive-class F1.

    Plain 0/1 accuracy lets a description that always predicts "no" score the
    negative-class fraction (0.75 at a 3:1 imbalance), so GEPA can climb by
    abandoning recall. Here a correct POSITIVE (TP) is worth 1.0 while a correct
    negative (TN) is worth only 0.5, and both error types score 0.0. Predict-all-
    "no" therefore caps at 0.5*neg_frac (e.g. 0.375 at 3:1) — strictly below a
    router that also catches positives — so the gradient points at recall+
    precision on the positive class, the same thing the holdout F1 gate rewards.

    Accepts GEPA's 5-arg call shape (gold, pred, trace, pred_name, pred_trace)
    and MIPROv2's 3-arg shape via *args/**kwargs."""
    expected = _norm_label(getattr(example, "label", "no"))
    predicted = _norm_label(getattr(prediction, "should_route", "no"))
    if expected == "yes":
        return 1.0 if predicted == "yes" else 0.0   # reward TP, punish FN (recall)
    return 0.5 if predicted == "no" else 0.0        # modest TN, punish FP (precision)


def f1_from_labels(y_true: Iterable[str], y_pred: Iterable[str]) -> dict:
    """Positive-class ('yes') precision / recall / F1 + accuracy. Pure."""
    tp = fp = fn = tn = 0
    for t, p in zip(y_true, y_pred):
        t = _norm_label(t)
        p = _norm_label(p)
        if t == "yes" and p == "yes":
            tp += 1
        elif t == "no" and p == "yes":
            fp += 1
        elif t == "yes" and p == "no":
            fn += 1
        else:
            tn += 1
    total = tp + fp + fn + tn
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    accuracy = (tp + tn) / total if total else 0.0
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "accuracy": round(accuracy, 4),
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }


def _ctx(lm):
    import dspy
    return dspy.context(lm=lm) if lm is not None else _nullcontext()


def routing_f1_on_holdout(module, holdout_dspy_examples: list, lm=None,
                          num_threads: int = 8) -> dict:
    """Run `module` over the blind holdout and return the F1 report.

    Fast path: `dspy.Evaluate(num_threads=…)` runs the holdout examples in
    parallel (each is one LLM call). If that API shape differs across DSPy
    versions, fall back to a correct serial loop — the result is identical, only
    slower. `module` is a built DescriptionModule; `lm` is an optional context.
    """
    import dspy  # lazy — only the real eval path needs it

    items = list(holdout_dspy_examples)
    # Fast path — parallel eval via dspy.Evaluate. Current DSPy returns an
    # EvaluationResult whose `.results` is a list of (example, prediction, score);
    # we ignore the score and recompute F1 from the predictions. Any API mismatch
    # falls through to the (always-correct) serial loop.
    try:
        ev = dspy.Evaluate(
            devset=items,
            metric=routing_fitness_metric,
            num_threads=max(1, min(num_threads, len(items))),
            display_progress=False,
        )
        with _ctx(lm):
            result = ev(module)
        triples = getattr(result, "results", None)
        if triples:
            y_true = [getattr(t[0], "label", "no") for t in triples]
            y_pred = [getattr(t[1], "should_route", "no") for t in triples]
            if y_true:
                return f1_from_labels(y_true, y_pred)
    except Exception:
        pass  # any API mismatch → serial fallback below

    # Serial fallback (always correct).
    y_true, y_pred = [], []
    with _ctx(lm):
        for ex in items:
            pred = module(user_prompt=ex.user_prompt)
            y_true.append(getattr(ex, "label", "no"))
            y_pred.append(getattr(pred, "should_route", "no"))
    return f1_from_labels(y_true, y_pred)


class _nullcontext:
    def __enter__(self):
        return None

    def __exit__(self, *exc):
        return False
