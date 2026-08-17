---
name: entrypoints
description: >
  Selects the right Prompting Company entrypoint: API, MCP Server, CLI, or SDK.
---

# Entrypoints

## Overview

Choose the smallest Prompting Company surface that matches the user's goal, then verify exact commands, setup, endpoints, or types from the live documentation.

## API

Use the API when the user needs:

- Language-agnostic integration from any backend or automation environment
- Exact control over HTTP methods, request bodies, query params, and response handling
- Public markdown routes for AI-readable published content
- Content management, app publishing, simulations, visibility analytics, authentication, or scope-specific calls
- Generated clients or types from the OpenAPI schema

Implementation steps:

1. Fetch `workflows/live-docs.md` and identify the API overview, OpenAPI schema, authentication docs, and scope reference.
2. Select the endpoint family: public markdown, content, apps and publishing, simulations, or visibility analytics.
3. Fetch the specific endpoint page or OpenAPI operation before writing code.
4. Use `https://app.promptingco.com` as the production base URL unless the live docs say otherwise.
5. Use `http://localhost:3000` only for local development.
6. Handle both non-2xx responses and the shared response envelope:

```json
{
  "ok": true,
  "data": {}
}
```

```json
{
  "ok": false,
  "code": "FORBIDDEN",
  "message": "public_api_only",
  "details": {}
}
```

## MCP Server

Use the MCP Server when the user wants agents or MCP-capable tools to access Prompting Company capabilities directly.

Use this entrypoint for:

- Claude, Codex, Cursor, VS Code, or another MCP client
- Agent workflows that should call Prompting Company tools instead of handwritten HTTP code
- Local setup, connector configuration, or troubleshooting MCP access

Implementation steps:

1. Fetch the live MCP Server tutorial from `workflows/live-docs.md`.
2. Follow the target client's MCP configuration format exactly.
3. Keep tokens and API keys in the client-supported secret mechanism.
4. Verify the MCP server appears in the client tool list before attempting workflows.
5. If a requested capability is not exposed through MCP, fall back to API, CLI, or SDK.

## CLI

Use the CLI when the user wants local operational workflows, repeatable commands, setup tasks, or shell-friendly automation.

Use this entrypoint for:

- Installing and authenticating local tooling
- Running repeatable Prompting Company operations from a terminal
- Creating scripts or CI steps that call Prompting Company commands
- Debugging environment or credential setup outside an app codebase

Implementation steps:

1. Fetch the live CLI tutorial from `workflows/live-docs.md`.
2. Follow the user's package manager and shell conventions.
3. Prefer documented commands over inferred flags.
4. Keep credentials out of shell history when possible.
5. For destructive or mutating commands, show the command and ask for confirmation unless the user already requested the mutation.

## SDK

Use the SDK when the user is building a TypeScript or Next.js application and wants idiomatic application code.

Use this entrypoint for:

- Typed application integrations
- Next.js examples or server-side app code
- Reusing the project's existing service-client patterns
- Avoiding handwritten fetch wrappers when the SDK covers the workflow

Implementation steps:

1. Fetch the live SDK introduction, installation, quickstart, and advanced usage pages from `workflows/live-docs.md`.
2. Install dependencies with the repository's existing package manager.
3. Place initialization near other service clients.
4. Keep API keys in environment variables or the host application's secret store.
5. If the SDK does not expose the needed operation, fall back to the API and document why.

## Quality Check

Before finishing:

- Confirm the chosen entrypoint matches the user's environment and goal.
- Confirm every endpoint, command, config field, scope, and type came from live docs or OpenAPI.
- Confirm no copied API reference content was added to the repository.
- Confirm credentials are not hard-coded.
- Confirm write and delete operations were explicitly requested or confirmed.
