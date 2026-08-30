# 🪶 headroom

Context-compression loadout. Compresses everything Claude reads — tool outputs,
logs, files, RAG chunks, conversation history — before it reaches the model, for
**60–95% fewer tokens with the same answers**. Compression is reversible (CCR:
Compress-Cache-Retrieve), so the model can pull the original back on demand.

Inherits `core`. Adds:

- the **headroom MCP** (`headroom_compress` / `headroom_retrieve` / `headroom_stats`)
- the **`tools/headroom`** skill (install, MCP tools, wrap, `headroom learn`)
- the **full traffic wrap**: `ANTHROPIC_BASE_URL` → local `headroom proxy`, so all
  Claude traffic is compressed transparently.

## Prerequisites

```bash
pip install "headroom-ai[all]"     # or [mcp] for just the MCP server
headroom --version
```

## Run the wrap

The profile sets `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`, which **requires the
proxy to be running**:

```bash
headroom proxy --port 8787          # start the local proxy (run as a service for daily use)
# ...then launch this profile.
```

Or let headroom manage it end-to-end: `headroom wrap claude`.

> ⚠️ If the proxy is **not** running, Claude cannot reach Anthropic (connection
> refused). For an always-on setup, run `headroom proxy` as a persistent service.

Upstream: <https://github.com/chopratejas/headroom> · docs:
<https://headroom-docs.vercel.app/docs>
