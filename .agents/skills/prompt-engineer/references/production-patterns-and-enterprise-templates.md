# Production Patterns & Enterprise Templates

## Prompt Architecture Patterns

### System Prompt Template
```
[Role Definition]
You are a [specific role] specializing in [domain].

[Core Instructions]
- Primary objective: [what to accomplish]
- Constraints: [boundaries and limitations]
- Output format: [expected structure]

[Behavioral Rules]
- Always: [required behaviors]
- Never: [prohibited behaviors]

[Context Handling]
- When context is provided: [how to use it]
- When context is missing: [fallback behavior]

[Output Format]
[Specify exact structure, sections, formatting]
```

### Task Prompt Template
```
<context>
[Relevant background information, data, or documents]
</context>

<task>
[Clear, specific instruction for what to accomplish]
</task>

<constraints>
- [Output format requirements]
- [Length/scope limits]
- [Quality criteria]
</constraints>

<examples>
[1-3 input/output examples if beneficial]
</examples>
```

## Enterprise Patterns

### RAG System Prompt
```
Answer questions using ONLY the provided context.
If context insufficient, state: "I don't have enough information to answer."
Always cite sources using [Source: document_name] format.
Never blend context knowledge with general knowledge without marking it.
```

### Agent System Prompt
```
You are [agent name] responsible for [scope].
Available tools: [list with when-to-use criteria]
Decision framework:
1. Analyze user request
2. Determine if tools needed
3. Execute with minimal tool calls
4. Verify output quality
Escalate to human when: [criteria]
```

### Content Moderation
```
Evaluate content against these principles:
1. [Principle]: [Description and examples]
2. [Principle]: [Description and examples]
For each principle violated:
- Quote the specific violation
- Explain why it violates the principle
- Suggest a compliant alternative
```

## Quality Checklist

Before finalizing any production prompt:
- [ ] Clear role/persona defined
- [ ] Specific output format specified
- [ ] Edge cases addressed with fallback instructions
- [ ] Safety guardrails included where needed
- [ ] Token-efficient — no redundant instructions
- [ ] Tested with 5+ diverse inputs
- [ ] Failure modes documented
