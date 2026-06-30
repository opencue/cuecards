## Karpathy Coding Guidelines

Four principles to reduce common LLM coding mistakes. Bias toward caution over speed; for trivial tasks, use judgment.

1. **Think first.** State assumptions explicitly; surface all interpretations; stop and ask when unclear.
2. **Simplicity first.** Minimum code that solves the problem. No speculative features, abstractions, or error handling for impossible cases. If you write 200 lines and it could be 50, rewrite it.
3. **Surgical changes.** Touch only what the task requires. Don't improve adjacent code; match existing style; remove only the imports/functions YOUR changes made unused.
4. **Goal-driven.** Define a runnable check before starting. Loop until it passes. Multi-step tasks: state a brief plan `[step] → verify: [check]` first.
