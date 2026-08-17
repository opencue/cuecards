# Structured Prompt Writer

A Claude Code skill for creating professional AI prompts with structured formats. Includes **395+ prompt templates**.

## Features

- **Dual Mode Support**
  - Detailed Mode: For complex personas, expert roles, and deep multi-turn interactions
  - Simple Mode: For single tasks, utility assistants, and quick deployments

- **395+ Built-in Templates**
  | Category | Count | Description |
  |----------|-------|-------------|
  | Structured Personas | 5 | High-quality Chinese prompts |
  | Xiaohongshu (RedNote) | 4 | Social commerce prompts |
  | Creative Writing | 3 | Writing templates |
  | GPT Store | 282 | OpenAI GPT Store prompts |
  | System Prompts | 101 | Claude/Cursor/Gemini tools |

- **Structured Format**
  - Tree-structured knowledge frameworks (├─ └─)
  - Conditional logic flows (? triggers)
  - Visual separators and markers

## Installation

### For Claude Code Users

1. Download the `.skill` file or clone this repository
2. Place it in your Claude Code skills directory
3. The skill will be available whenever you need to create prompts

### Manual Usage

Copy the SKILL.md content and use it as a system prompt for any LLM.

## Directory Structure

```
structured-prompt-writer/
├── README.md                    # This file
├── SKILL.md                     # Main skill definition
└── references/
    ├── format-templates.md      # Format templates
    ├── example-prompts.md       # Example comparisons
    ├── prompt-catalog.md        # Full prompt catalog
    └── prompts/                 # 395+ built-in prompts
        ├── personas/            # Structured personas (5)
        ├── xiaohongshu/         # Xiaohongshu (RedNote) series (4)
        ├── creative/            # Creative writing (3)
        ├── gpts-personas/       # GPT Store prompts (282)
        ├── system-tools/        # System prompts (101)
        │   ├── Anthropic/
        │   ├── Cursor Prompts/
        │   ├── Google/
        │   ├── Open Source prompts/
        │   └── ...
        └── awesome-chatgpt-prompts.md
```

## Quick Start

1. Choose a mode based on complexity
2. Refer to format-templates.md for structure
3. Browse prompts/ for similar examples:
   - Learn structured format → `personas/`
   - Xiaohongshu (RedNote) operations → `xiaohongshu/`
   - Find specific functions → `gpts-personas/`
   - Study system prompts → `system-tools/`
4. Fill in the sections following the template
5. Apply the writing principles

## Writing Principles

| Principle | Description |
|-----------|-------------|
| Poetic Opening | Use metaphors; avoid "I am an AI assistant" |
| Human Touch | Show personality, values, and even flaws |
| Restrained Precision | Concise like a manual — every word matters |
| Anti-AI Flavor | Distinctive voice; reject buzzwords |

## Format Symbols

| Symbol | Usage |
|--------|-------|
| ━━━━ | Section separator |
| ： | Requirement definition |
| ├─ └─ | Tree structure |
| ▸ | Arrow pointer |
| ▪ | List item |
| ① ② ③ | Ordered steps |
| 『』 | Emphasis title |
| 〖〗 | Protocol title |

## Included System Prompts

- **Anthropic**: Claude Code, Claude for Chrome
- **Code Editors**: Cursor, Windsurf, VSCode Agent
- **Open Source**: RooCode, Cline, Bolt, Codex CLI, Gemini CLI
- **AI Platforms**: Gemini, Replit, Perplexity, v0, Lovable, Devin AI

## License

MIT

## Credits

- Prompt templates inspired by [Awesome Gemini Prompts](https://github.com/langgptai/awesome-gemini-prompts)
- GPT Store prompts contributed by the community
- System prompts sourced from the respective tool documentation
- Author: Yun Zhong Jiang Shu and contributors
