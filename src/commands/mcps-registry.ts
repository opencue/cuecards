import { parseArgs } from "node:util";

const endpoint = "https://registry.modelcontextprotocol.io/v0.1/servers";
const usage = "Usage: cue mcps search <query> [--limit 1-30] [--json]";
const maxBytes = 1024 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function displayText(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.slice(0, max).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim() : "";
}

function repositoryUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) return url.href;
  } catch {
    // A malformed source URL is not useful for reviewing the server.
  }
}

function summarize(value: unknown) {
  const server = record(record(value)?.server);
  const name = displayText(server?.name, 200);
  if (!server || !name) return [];
  const packages = Array.isArray(server.packages) ? server.packages.slice(0, 6).flatMap((value: unknown) => {
    const pkg = record(value);
    const registry = displayText(pkg?.registryType, 20);
    const identifier = displayText(pkg?.identifier, 200);
    return registry && identifier ? [{ registry, identifier, version: displayText(pkg?.version, 60) }] : [];
  }) : [];
  const transports = [
    ...(Array.isArray(server.remotes) ? server.remotes.slice(0, 6).map((remote: unknown) => record(remote)?.type) : []),
    ...(Array.isArray(server.packages) ? server.packages.slice(0, 6).map((pkg: unknown) => record(record(pkg)?.transport)?.type) : []),
  ].map((type) => displayText(type, 40)).filter(Boolean);
  return [{
    name, version: displayText(server.version, 60), description: displayText(server.description, 200),
    repository: repositoryUrl(record(server.repository)?.url), packages, transports: [...new Set(transports)],
  }];
}

async function readRegistryResponse(response: Response): Promise<Record<string, unknown> | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return;
      }
      body += decoder.decode(value, { stream: true });
    }
    return record(JSON.parse(body + decoder.decode()));
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 1;
}

export async function searchMcpRegistry(args: string[]): Promise<number> {
  let query: string;
  let limit: number;
  let json: boolean | undefined;
  try {
    const { values, positionals } = parseArgs({
      args, allowPositionals: true,
      options: { limit: { type: "string" }, json: { type: "boolean" } },
    });
    query = positionals.join(" ").trim();
    const rawLimit = values.limit ?? "10";
    limit = Number(rawLimit);
    json = values.json;
    const length = Array.from(query).length;
    if (length < 3 || length > 100 || !/^\d{1,2}$/.test(rawLimit) || limit < 1 || limit > 30) {
      return fail(usage);
    }
  } catch {
    return fail(usage);
  }
  if ((process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1") {
    return fail("MCP Registry search is unavailable in offline mode.");
  }

  const url = new URL(endpoint);
  url.search = new URLSearchParams({ search: query, version: "latest", limit: String(limit) }).toString();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
  } catch {
    return fail("MCP Registry search failed. Check your connection and try again.");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return fail(`MCP Registry returned HTTP ${response.status}.`);
  }
  const result = await readRegistryResponse(response);
  if (!Array.isArray(result?.servers)) return fail("MCP Registry returned an invalid response.");
  const servers = result.servers.slice(0, limit).flatMap(summarize);
  const cursor = record(result.metadata)?.nextCursor;
  const hasMore = typeof cursor === "string" && cursor.length > 0;
  if (json) {
    process.stdout.write(JSON.stringify({ hasMore, servers }, null, 2) + "\n");
    return 0;
  }
  if (!servers.length) {
    process.stdout.write("No matching servers in the official MCP Registry.\n");
    return 0;
  }
  const lines = servers.flatMap(({ name, version, description, repository, packages, transports }) => [
    `${name}${version ? ` @ ${version}` : ""}${description ? ` — ${description}` : ""}`,
    ...packages.map(({ registry, identifier, version }) => `  Package: ${registry}:${identifier}${version ? ` @ ${version}` : ""}`),
    ...(transports.length ? [`  Transport: ${transports.join(", ")}`] : []),
    ...(repository ? [`  Source: ${repository}`] : []),
  ]);
  if (hasMore) lines.push("More matches exist. Refine the query or increase --limit.");
  lines.push("Discovery only: no MCP server was added or started.");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
