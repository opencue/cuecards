import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

function promptBlock(): string {
  const md = readFileSync(join(REPO_ROOT, "setup/agent-prompt.md"), "utf8");
  const m = md.match(/```text\n([\s\S]*?)```/);
  if (!m) throw new Error("setup/agent-prompt.md has no ```text fenced block");
  return m[1]!;
}

describe("agent-paste install prompt", () => {
  test("delegates to cue setup instead of restating its steps", () => {
    const block = promptBlock();
    expect(block).toContain("npm install -g cue-ai");
    expect(block).toContain("cue setup");
    // `cue shell install` / `cue init` appearing here would mean a second,
    // drifting description of the install flow.
    expect(block).not.toContain("cue shell install");
    expect(block).not.toContain("cue init");
  });

  test("never installs without asking, and never pipes a script to a shell", () => {
    const block = promptBlock();
    expect(block).toContain("Do not install anything without asking me first.");
    expect(block).not.toContain("curl");
    expect(block).not.toContain("| bash");
  });

  test("is agent-agnostic — no vendor-specific syntax", () => {
    const block = promptBlock();
    for (const vendorism of ["/plugin", "CLAUDE.md", "AGENTS.md", "@codex", "Cursor:"]) {
      expect(block).not.toContain(vendorism);
    }
  });

  test("README inlines the block verbatim", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain(promptBlock().trim());
  });
});
