# Model-Specific Optimization Guide

## Anthropic Claude (Opus, Sonnet, Haiku)

**Strengths**: Long context, instruction following, XML structure, safety alignment
**Best practices**:
- Use XML tags (`<context>`, `<instructions>`, `<output>`) for clear prompt sections
- Place most important instructions at start and end (primacy/recency)
- Use `<thinking>` blocks for chain-of-thought reasoning
- Leverage system prompt for persistent behavioral instructions
- Claude responds well to direct, imperative instructions
- Avoid "please" and hedging — be direct about expectations
- **Temperature**: 0 for deterministic, 0.3-0.7 for creative, 1.0 for brainstorming
- **Max tokens**: Set explicitly to avoid truncation

## OpenAI GPT-4o / o1 / o1-mini

**Strengths**: Function calling, JSON mode, structured outputs, code generation
**Best practices**:
- Use system message for role/persona, user message for task
- Enable JSON mode with `response_format: { type: "json_object" }`
- For o1 models: skip chain-of-thought (built-in reasoning), keep prompts concise
- Function/tool definitions: use clear parameter descriptions with enum constraints
- **Temperature**: 0-0.2 for factual, 0.7-1.0 for creative
- Structured outputs: define JSON schema in system message

## Open Source (Llama, Mixtral, Qwen)

**Strengths**: Customizable, fine-tunable, no API dependency
**Best practices**:
- Use model-specific chat templates (e.g., `[INST]` for Llama)
- Keep prompts shorter — smaller context windows
- Be more explicit with instructions — less implicit understanding
- Test with quantized versions if deploying locally
- Simpler prompt structures work better than complex nesting
- Few-shot examples more critical than with larger models

## Cross-Model Tips

- **Prompt portability**: Start with clear structure, adapt formatting per model
- **Token budget**: Allocate ~70% to context/instructions, ~30% to output space
- **Iteration**: Same prompt performs differently across models — always test
- **Fallback design**: Build prompts that degrade gracefully on weaker models
