"""A DSPy LM backed by headless `claude -p` — the "use Claude Code itself" path.

Why this exists: DSPy/GEPA runs as a standalone process and needs a programmatic
LM endpoint, which normally means a separate (paid) model API key. But cue runs
under Claude Code, which already authenticates to a model. `claude -p` is
headless Claude Code as a completion engine (the same trick the self-learner
hook uses, resources/hooks/profile-self-improve.sh). Routing DSPy through it
means the evolver needs NO separate API key and no marginal cost beyond the
user's existing Claude Code plan.

Model strings: "claude-code/sonnet", "claude-code/opus", "claude-code/haiku"
(the part after the slash is passed to `claude -p --model`).

dspy is imported lazily inside the class so this module stays import-safe in the
offline/dry-run path; the factory `make_lm` is the public entry point.
"""

import os
import shutil
import subprocess


CLAUDE_CODE_PREFIX = "claude-code/"


def is_claude_code_model(model: str) -> bool:
    return isinstance(model, str) and model.startswith(CLAUDE_CODE_PREFIX)


def claude_model_name(model: str, default: str = "sonnet") -> str:
    """Map a model string to the `claude -p --model` name (the part after the
    slash for claude-code/*; otherwise the default)."""
    if is_claude_code_model(model):
        return model.split("/", 1)[1] or default
    return default


def run_claude_p(prompt: str, model: str = "sonnet", timeout: int = 300) -> str:
    """Call headless `claude -p` and return its text output. DSPy-free.

    Uses the user's existing Claude Code auth — no API key. Sets
    CUE_AUTO_IMPROVE_INNER=1 so the spawned Claude's self-improve hook is a
    no-op (no recursive triggering).
    """
    if not shutil.which("claude"):
        raise RuntimeError("claude CLI not on PATH — needs Claude Code installed.")
    env = {**os.environ, "CUE_AUTO_IMPROVE_INNER": "1"}
    try:
        proc = subprocess.run(
            ["claude", "-p", "--model", model],
            input=prompt, capture_output=True, text=True, timeout=timeout, env=env,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"claude -p timed out after {timeout}s") from None
    if proc.returncode != 0:
        raise RuntimeError(f"claude -p failed ({proc.returncode}): {proc.stderr.strip()[:300]}")
    return proc.stdout.strip()


def make_lm(model: str, config):
    """Return the right DSPy LM for a model string.

    `claude-code/*` → ClaudeCodeLM (keyless, via `claude -p`).
    anything else   → dspy.LM(model, **config.lm_kwargs()) (LiteLLM providers).
    """
    import dspy

    if is_claude_code_model(model):
        return ClaudeCodeLM(model=model)
    return dspy.LM(model, **config.lm_kwargs())


def _make_claude_code_lm_class():
    """Build the ClaudeCodeLM class (needs dspy at call time, not import time)."""
    import dspy

    class ClaudeCodeLM(dspy.BaseLM):
        """DSPy LM that shells out to headless `claude -p`. No API key required."""

        def __init__(self, model: str = "claude-code/sonnet", timeout: int = 300, **kwargs):
            super().__init__(model=model, **kwargs)
            self._claude_model = claude_model_name(model)
            self._timeout = timeout

        # --- prompt rendering --------------------------------------------
        @staticmethod
        def _render(prompt, messages) -> str:
            if messages:
                parts = []
                for m in messages:
                    role = m.get("role", "user")
                    content = m.get("content", "")
                    if isinstance(content, list):  # multimodal blocks → text only
                        content = "".join(
                            b.get("text", "") for b in content if isinstance(b, dict)
                        )
                    parts.append(f"[{role}]\n{content}")
                return "\n\n".join(parts)
            return prompt or ""

        # --- dspy.BaseLM contract ----------------------------------------
        def forward(self, prompt=None, messages=None, **kwargs):
            text = run_claude_p(self._render(prompt, messages), self._claude_model, self._timeout)
            return _openai_response(text, self.model)

    return ClaudeCodeLM


def _openai_response(text: str, model: str):
    """Wrap a completion string in an OpenAI-chat-shaped litellm ModelResponse,
    which is what dspy.BaseLM._process_lm_response expects."""
    from litellm.types.utils import ModelResponse, Choices, Message, Usage

    return ModelResponse(
        choices=[Choices(index=0, message=Message(role="assistant", content=text),
                         finish_reason="stop")],
        model=model,
        usage=Usage(prompt_tokens=0, completion_tokens=0, total_tokens=0),
    )


# Lazily-built singleton class accessor.
_CLS = None


def ClaudeCodeLM(*args, **kwargs):  # noqa: N802 — factory mimicking a class
    global _CLS
    if _CLS is None:
        _CLS = _make_claude_code_lm_class()
    return _CLS(*args, **kwargs)
