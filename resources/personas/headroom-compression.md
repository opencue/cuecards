## Save tokens with headroom

This session has opted into the local **headroom** compression proxy
(`ANTHROPIC_BASE_URL` → 127.0.0.1:8787): prompts, tool outputs, and history are
compressed before they reach the model (60–95% fewer tokens, reversible). The
wrap is health-gated at launch, so a down or unresponsive proxy falls back to
direct Anthropic instead of breaking.

**For large in-turn payloads, reach for the headroom MCP.** Before pouring a big
blob into context (long logs, file dumps, command output, RAG chunks), run it
through `headroom_compress` and work from the compressed view; pull originals back
with `headroom_retrieve` when you need a dropped detail; check savings with
`headroom_stats`. Compression is reversible (CCR) — prefer it over truncating or
guessing.

**Threshold: compress any Bash output >2 KB or any file read >5 KB.** Call `headroom_compress(content=<output>)` before reasoning over it; the compressed view is what stays in context.

Connection or saturation errors mean the proxy is down, unhealthy, or overloaded.
Restart it with `headroom proxy --port 8787`, or relaunch without the `headroom`
profile for direct Anthropic.
