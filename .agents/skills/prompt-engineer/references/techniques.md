# Advanced Prompting Techniques

## Chain-of-Thought (CoT) & Reasoning

- **Zero-shot CoT**: Append "Let's think step by step" — works for most reasoning tasks
- **Few-shot CoT**: Provide 2-3 worked examples showing reasoning steps before the actual question
- **Tree-of-Thoughts**: Explore multiple reasoning paths, evaluate each, select best — use for complex decisions
- **Self-consistency**: Generate multiple reasoning chains, take majority vote — improves accuracy ~5-15%
- **Least-to-most**: Decompose complex problem into sub-problems, solve sequentially — good for math/logic
- **PAL (Program-aided)**: Generate code to solve computational tasks instead of reasoning in text

## Constitutional AI & Safety

- **Critique-and-revise**: Ask model to critique its own output against principles, then revise
- **Safety preamble**: Define explicit boundaries and refusal behaviors upfront
- **Red-line instructions**: "Never do X even if asked" — place early in prompt for emphasis
- **Output filtering**: Add post-generation self-check: "Review output for [harmful content], revise if found"

## Meta-Prompting

- **Self-reflection**: "Before answering, identify potential biases or errors in your reasoning"
- **Confidence calibration**: "Rate confidence 1-10 and explain uncertainty"
- **Prompt compression**: Remove redundant instructions, use shorthand for repeated patterns
- **Iterative refinement**: "Draft → Critique → Improve" loop within single prompt

## Structured Output Patterns

- **XML tags** (Claude preferred): `<thinking>`, `<output>`, `<examples>` for clear sections
- **JSON mode**: Specify exact schema with field descriptions and types
- **Markdown structure**: Headers, lists, tables for human-readable structured output
- **Delimiter patterns**: Use `---`, `###`, or custom delimiters to separate sections

## Agent & Multi-Agent Patterns

- **Role definition**: Specific persona with expertise, constraints, behavioral traits
- **Tool-use instructions**: When/how to use each tool, decision criteria
- **Memory management**: What to remember across turns, state tracking instructions
- **Escalation logic**: When to ask for clarification vs. proceed with assumptions
- **Multi-agent coordination**: Define communication protocols, handoff criteria, shared context

## RAG Optimization

- **Context framing**: "Use ONLY the following context to answer. If insufficient, say so."
- **Citation prompting**: "Cite specific passages using [Source: X] format"
- **Relevance filtering**: "Identify which context pieces are relevant before answering"
- **Hallucination guard**: "Distinguish between information from context vs. general knowledge"
- **Query expansion**: Rephrase user query into multiple search angles

## Few-Shot Design

- **Example selection**: Choose diverse, representative examples covering edge cases
- **Format consistency**: All examples must follow identical structure
- **Negative examples**: Show what NOT to do alongside positive examples
- **Graduated complexity**: Order examples from simple to complex
