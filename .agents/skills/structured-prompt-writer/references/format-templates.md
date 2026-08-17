# Structured Prompt Format Templates

This document provides two prompt-writing templates: Detailed Mode and Simple Mode.

## Table of Contents

1. [Detailed Mode](#detailed-mode)
2. [Simple Mode](#simple-mode)
3. [Format Element Reference](#format-element-reference)

---

## Detailed Mode

Best for: complex roles, specialized domains, scenarios requiring deep interaction

```markdown
# [Role Name]

━━━━━━━━━━━━━━━━
## Requirements
: Input (what the user must provide)
: Output (what the AI will produce)
: Model — Gemini 3.0 Pro / Claude Sonnet 4.5
: Author — [author name]
: Version — [version number]

[Opening narrative paragraph — describe the essence of the role in poetic or philosophical language, 2-4 lines]

━━━━━━━━━━━━━━━━
## [Core Philosophy / Essence / Worldview]

[Describe the role's core mode of thinking, values, and way of seeing the world]

━━━━━━━━━━━━━━━━
## [Knowledge / Skills / Frameworks]

① [Dimension One]
├─ Core ▸ [core idea]
└─ Application ▸ [how it is applied]

② [Dimension Two]
├─ Core ▸ [core idea]
└─ Application ▸ [how it is applied]

③ [Dimension Three]
├─ Core ▸ [core idea]
└─ Application ▸ [how it is applied]

━━━━━━━━━━━━━━━━
## [Methodology / Workflow]

? [Trigger condition]

Step 1: [step name]
├─ [sub-step] ▸ [description]
├─ [sub-step] ▸ [description]
└─ [sub-step] ▸ [description]

Step 2: [step name]
├─ [sub-step] ▸ [description]
└─ [sub-step] ▸ [description]

Step 3: [step name]
└─ [description]

━━━━━━━━━━━━━━━━
## [Aesthetics / Taboos / Constraints]

『[Positive requirements]』
▪ [Point one]
▪ [Point two]
▪ [Point three]

『[Prohibitions]』
▪ [Prohibition one]
▪ [Prohibition two]
▪ [Prohibition three]

━━━━━━━━━━━━━━━━
## Interaction Protocol

〖[Protocol One]〗
[Specific description]

〖[Protocol Two]〗
[Specific description]

━━━━━━━━━━━━━━━━
## Initialization

[The role's opening line, in first person, inviting the user to begin]
```

---

## Simple Mode

Best for: single tasks, utility assistants, quick deployment

```markdown
# [Role Name]

━━━━━━━━
## Requirements
: Input    [user input]
: Output   [AI output]
: Model    [recommended model]
: Author   [author name]
: Version  [version number]

━━━━━━━━
## Essence

[1-2 paragraphs describing the role's core traits]

━━━━━━━━
## Rules

① [Rule one]
② [Rule two]
③ [Rule three]

━━━━━━━━
## Flow

[Step 1] → [Step 2] → [Step 3] → [Step 4]

━━━━━━━━
## Begin

[Brief opening line]
```

---

## Format Element Reference

### Separators
- `━━━━━━━━` — major section divider (use full-width em-dashes)
- Length can be adjusted for visual balance (8-16 characters)

### Markers
- `:` — full-width colon, used for requirement definitions
- `▸` — arrow, used to point to an explanation
- `├─` / `└─` — tree structure
- `▪` — list item
- `?` — conditional-trigger marker
- `『』` — emphasis title
- `〖〗` — protocol / constraint title

### Structural Hierarchy
```
## Level-one heading (section)
### Level-two heading (sub-section, optional)
① ② ③ — ordered list
├─ └─ — tree children
▪ — unordered list
```

### Language Style
- **Poetic opening**: use metaphor and imagery to describe the role's essence
- **Spare and restrained**: precise, like a technical spec
- **Inject humanity**: let personality and values show through
- **Avoid the AI-ish tone**: skip phrasings like "I am an AI assistant"

### Model Recommendation Format
```
: Model — Gemini 3.0 Pro / Claude Sonnet 4.5
: Model — Gemini 3.0 Pro / Claude Opus 4.5
```
