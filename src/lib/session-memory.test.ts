import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureSessionMemory } from "./session-memory";

test.skipIf(!process.geteuid)("attributes launcher, agent, MCP subtrees and other descendants without double counting", async () => {
  const proc = mkdtempSync(join(tmpdir(), "cue-memory-"));
  const uid = process.geteuid?.() ?? 0;
  const add = (pid: number, parent: number, argv: string[], pss?: number, owner = uid) => {
    const dir = join(proc, String(pid));
    mkdirSync(dir);
    writeFileSync(join(dir, "stat"), `${pid} (name ) with spaces) S ${parent} ${"0 ".repeat(17)}${pid} 0\n`);
    writeFileSync(join(dir, "cmdline"), argv.join("\0") + "\0");
    writeFileSync(join(dir, "status"), `Name:\ttest\nUid:\t${uid}\t${owner}\t${uid}\t${uid}\n`);
    if (pss !== undefined) {
      writeFileSync(join(dir, "smaps_rollup"), `Rss: 999 kB\nPss: ${pss} kB\nSwapPss: 200 kB\n`);
    }
  };
  try {
    add(10, 1, ["bun", "src/index.ts", "launch", "codex"], 100);
    add(11, 10, ["node", "/path/omx"], 20);
    add(12, 11, ["codex"], 300);
    add(13, 12, ["node", "/path/gitnexus", "mcp"], 250);
    add(14, 13, ["mcp-helper"], 50);
    add(15, 12, ["node", "/project/build.js", "mcp"], 70);
    add(16, 12, ["claude"], 200);
    add(17, 16, ["test"], 60);
    add(18, 12, ["unreadable"]);
    add(19, 1, ["unrelated"], 900);
    add(20, 1, ["codex"]);
    add(21, 12, ["node", "/repo/dist/cue.js", "launch", "claude"], 100);
    add(22, 21, ["claude"], 1);
    add(23, 21, ["claude"], 2);
    add(24, 12, ["bun", "/repo/src/index.ts", "launch", "codex"], 50);
    add(25, 24, ["node", "/path/omx"], 10);
    add(26, 25, ["codex"], 200);
    add(27, 1, ["reused-pid"], 999);
    add(28, 10, ["launcher-helper"], 70);
    add(29, 25, ["nested-wrapper-helper"], 80);
    add(30, 12, ["different-owner"], 999, uid + 1);
    expect(await measureSessionMemory(new Map([[12, 12], [16, 16], [20, 20], [22, 22], [23, 23], [26, 26], [27, 2], [99, 99]]), proc)).toEqual(new Map([
      [12, {
        totalPssKiB: 860,
        byRole: { launcher: 100, agent: 300, mcp: 300, other: 160 },
        measuredProcesses: 7,
        unreadableProcesses: 2,
      }],
      [16, {
        totalPssKiB: 260,
        byRole: { launcher: 0, agent: 200, mcp: 0, other: 60 },
        measuredProcesses: 2,
        unreadableProcesses: 0,
      }],
      [20, {
        totalPssKiB: null,
        byRole: { launcher: 0, agent: 0, mcp: 0, other: 0 },
        measuredProcesses: 0,
        unreadableProcesses: 1,
      }],
      [22, {
        totalPssKiB: 1,
        byRole: { launcher: 0, agent: 1, mcp: 0, other: 0 },
        measuredProcesses: 1,
        unreadableProcesses: 0,
      }],
      [23, {
        totalPssKiB: 2,
        byRole: { launcher: 0, agent: 2, mcp: 0, other: 0 },
        measuredProcesses: 1,
        unreadableProcesses: 0,
      }],
      [26, {
        totalPssKiB: 340,
        byRole: { launcher: 50, agent: 200, mcp: 0, other: 90 },
        measuredProcesses: 4,
        unreadableProcesses: 0,
      }],
    ]));
  } finally {
    rmSync(proc, { recursive: true, force: true });
  }
});
