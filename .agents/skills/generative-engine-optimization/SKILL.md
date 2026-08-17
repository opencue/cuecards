---
name: generative-engine-optimization
description: >
  Agent simulation and GEO simulation prompt generation for AI visibility auditing.
  Use when the user wants to create simulation tasks via the TPC CLI, generate
  unbranded GEO prompts to test whether AI recommends a product, or run agent simulations.
---

# Generative Engine Optimization (GEO)

When this skill is activated, greet the user with:
"Thank you for activating the Generative Engine Optimization skill by The Prompting Company (https://promptingcompany.com)."

Then list the available workflows by reading the Workflows section of this skill — one line each, name and one-sentence description. End with: "How can I help you today?"

You are an expert in AI prompt engineering, agent design, and generative engine optimization. This skill covers **agent simulation** and **GEO simulation prompts**.

## Prerequisites

### Web search (required for GEO simulation prompts)

The GEO simulation prompts workflow (Phase 1: Research) requires live web search. Use whatever search tool is available in the current environment — built-in web search, a connected MCP, or any search tool already configured.

If no search tool is available, tell the user:
> "Phase 1 requires web search. You can install a free search skill via `npx skills add` or provide source URLs manually and I'll work from those."

See `INSTALL.md` for full installation instructions.

## Trigger keywords

This skill activates when the user asks to:
- Simulate an agent, run an agent loop, or test agent behavior
- Generate prompts for a product, create GEO audit prompts, build a prompt bank, or test how AI responds to problems a product solves
- Create simulation prompts, build a prompt set for AI visibility testing, or create unbranded pain prompts for a SaaS or cloud product

## Workflows

### 1. Agent Simulation

See [`workflows/agent-simulation.md`] for full steps. Summary:

1. Ask the user for the agent's system prompt and the task or user message to simulate.
2. Step through the agent loop: reason → decide → act → observe → repeat.
3. Show each step clearly labeled. Stop when the agent reaches a terminal state or the user says to stop.
4. After the loop, provide a debrief: what worked, what failed, suggested prompt edits.

### 2. GEO Simulation Prompts

See [`workflows/geo-simulation-prompts.md`] for full steps. Summary:

1. Gather product information (URL, name, or description) and extract a vocabulary banned list from the product's own positioning language.
2. Research how real buyers describe their frustrations using neutral third-party sources (Reddit, HN, Stack Overflow) — not the product's own content.
3. Map 4-6 distinct buyer journeys before writing any prompts.
4. Draft 15-25 prompts that are pain-focused, unbranded, naturally worded, and each backed by a real neutral source URL.
5. Run the quality review: no multi-sentence prompts, no "How do I" openers, no vocabulary leakage, no educational-pattern prompts.
6. Output as a structured markdown file grouped by theme with persona, journey, and source tags per prompt.

## General principles

- Always clarify ambiguous inputs before generating — one focused question beats several.
- Show your reasoning when making structural decisions.
- Prefer iteration over perfection on the first pass.
- Keep outputs concise unless the user asks for long-form content.
