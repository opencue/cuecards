# Install Prompting Company

## Claude Code

Copy the skill into your local Claude skills directory:

```bash
mkdir -p ~/.claude/skills
cp -r skills/prompting-company ~/.claude/skills/
```

Restart Claude Code or reload skills if your environment supports it.

## claude.ai

Upload the `skills/prompting-company` folder as a custom skill.

## MCP and agent environments

Install the folder wherever your agent runtime loads skills from. Keep the folder name `prompting-company`.

## Requirements

This skill needs network access to fetch live documentation from:

- https://docs.promptingcompany.com/api
- https://docs.promptingcompany.com/llms.txt
- https://docs.promptingcompany.com/api-reference/openapi.json
- https://app.promptingco.com/api/v1/openapi.json
- https://docs.promptingcompany.com/ts-sdk/introduction
- https://docs.promptingcompany.com/tutorial/CLI
- https://docs.promptingcompany.com/tutorial/MCP-Server
