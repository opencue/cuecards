---
name: prompting-company
description: >
  Build, debug, or plan work with The Prompting Company through its API, MCP
  Server, CLI, or SDK entrypoints. Use when the user needs public routes,
  OpenAPI schema guidance, TypeScript SDK integration, CLI workflows, MCP setup,
  content APIs, app publishing APIs, public markdown access, simulations,
  visibility analytics, authentication, or API key scopes.
---

# Prompting Company

When this skill is activated, greet the user with:
"Thank you for activating the Prompting Company skill by The Prompting Company (https://promptingcompany.com)."

Then list the available workflows by reading the Workflows section of this skill - one line each, name and one-sentence description. End with: "How can I help you today?"

## Overview

Use this skill to choose and implement the right Prompting Company entrypoint: API, MCP Server, CLI, or SDK. Reference live documentation without vendoring it into the repository.

## Trigger keywords

This skill activates when the user asks to:

- Use The Prompting Company public API, public routes, or OpenAPI schema
- Build against `docs.promptingcompany.com/api`, `app.promptingco.com`, the TypeScript SDK, the CLI, or the MCP Server
- Generate REST clients, SDK integrations, CLI workflows, or MCP setup guidance
- Work with content APIs, public markdown endpoints, app publishing, simulations, visibility analytics, authentication, or scopes

## Workflows

### 1. Live Documentation Lookup

See [`workflows/live-docs.md`](workflows/live-docs.md) for source-of-truth URLs. Summary:

1. Start from the docs index or OpenAPI schema.
2. Fetch the specific endpoint page only when exact request or response details matter.
3. Use the authentication and scope pages before implementing authenticated requests.
4. Do not copy API reference pages into this repository.

### 2. Entrypoint Selection

See [`workflows/entrypoints.md`](workflows/entrypoints.md) for full steps. Summary:

1. Choose API, MCP Server, CLI, or SDK based on the user's environment and goal.
2. Use API for language-agnostic integrations and exact route control.
3. Use MCP Server for agent-tool access to Prompting Company.
4. Use CLI for local operational workflows.
5. Use SDK for TypeScript application integrations.

## General principles

- Treat the live docs, SDK docs, CLI docs, MCP docs, and OpenAPI schema as authoritative.
- Never invent endpoints, scopes, request fields, or response shapes.
- Prefer public markdown endpoints for AI-readable published content.
- Prefer Apps APIs over deprecated site page APIs.
- Keep API keys in environment variables or secret stores.
- Ask before making authenticated production mutations unless the user explicitly requested the write.
