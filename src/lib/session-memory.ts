import { readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface SessionMemory {
  totalPssKiB: number | null;
  byRole: { launcher: number; agent: number; mcp: number; other: number };
  measuredProcesses: number;
  unreadableProcesses: number;
}

type Role = keyof SessionMemory["byRole"];

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function processStat(path: string) {
  const stat = read(path);
  const end = stat.lastIndexOf(")");
  if (end === -1) return null;
  // comm may contain parentheses and spaces. Fields after it start at #3.
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const started = Number(fields[19]);
  if (!Number.isSafeInteger(ppid) || !Number.isSafeInteger(started) || fields[0] === "Z") {
    return null;
  }
  return { ppid, started };
}

function isLauncher(argv: string[]): boolean {
  return (
    /\/(?:src\/index\.ts|dist\/cue\.js|bin\/cue(?:\.mjs)?)$/.test(argv[1] ?? "") &&
    argv[2] === "launch" &&
    (argv[3] === "codex" || argv[3] === "claude")
  );
}

function isMcp(argv: string[]): boolean {
  // Not all MCP transports are identifiable from argv. Unknown helpers stay
  // in "other", and detached servers are not attributed to a session.
  const command = argv.slice(0, -1);
  const mode = argv.at(-1);
  return (
    (mode === "mcp" && command.some((arg) => /(?:^|\/)(?:gitnexus|rea(?:-ag)?)(?:\/|@|$)/.test(arg))) ||
    (mode === "serve" && command.some((arg) => /(?:^|\/)codegraph(?:[-/]|$)/.test(arg))) ||
    argv.slice(0, 2).some((arg) => /(?:^|\/)mcp-server-[^/]+$/.test(arg))
  );
}

async function readPss(dir: string, started: number): Promise<number | null> {
  try {
    // Even a privileged dashboard should not expose other users' footprints.
    if (statSync(dir).uid !== process.geteuid?.()) return null;
    const rollup = await readFile(`${dir}/smaps_rollup`, "utf8");
    const kiB = Number(/^Pss:[ \t]+(\d+)[ \t]+kB$/m.exec(rollup)?.[1]);
    return Number.isSafeInteger(kiB) && processStat(`${dir}/stat`)?.started === started
      ? kiB
      : null;
  } catch {
    return null;
  }
}

/** Read proportional resident memory (Linux PSS), without summing nested sessions twice. */
export async function measureSessionMemory(pids: number[], proc = "/proc"): Promise<Map<number, SessionMemory>> {
  const results = new Map<number, SessionMemory>();
  if (!pids.length) return results;
  let entries: string[];
  try {
    entries = readdirSync(proc);
  } catch {
    return results;
  }

  const rows = new Map<number, NonNullable<ReturnType<typeof processStat>>>();
  const children = new Map<number, number[]>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const row = processStat(`${proc}/${entry}/stat`);
    if (!row) continue;
    const pid = Number(entry);
    rows.set(pid, row);
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(pid);
    else children.set(row.ppid, [pid]);
  }

  const roots = new Set(pids);
  const argv = (pid: number) => read(`${proc}/${pid}/cmdline`).split("\0").filter(Boolean);
  const launchPaths = new Map<number, number[]>();
  const owners = new Map<number, number>();
  for (const pid of roots) {
    const path: number[] = [];
    let child = rows.get(pid);
    while (child && child.ppid > 1 && !roots.has(child.ppid) && !path.includes(child.ppid)) {
      const parent = rows.get(child.ppid);
      if (!parent || parent.started > child.started) break;
      path.push(child.ppid);
      if (isLauncher(argv(child.ppid))) {
        launchPaths.set(pid, path);
        for (const ancestor of path) owners.set(ancestor, (owners.get(ancestor) ?? 0) + 1);
        break;
      }
      child = parent;
    }
  }

  for (const pid of roots) {
    if (!rows.has(pid)) continue;
    const memory: SessionMemory = {
      totalPssKiB: null,
      byRole: { launcher: 0, agent: 0, mcp: 0, other: 0 },
      measuredProcesses: 0,
      unreadableProcesses: 0,
    };
    const record = async (processId: number, role: Role) => {
      const row = rows.get(processId);
      const pss = row ? await readPss(`${proc}/${processId}`, row.started) : null;
      if (pss === null) {
        memory.unreadableProcesses++;
      } else {
        memory.measuredProcesses++;
        memory.byRole[role] += pss;
        memory.totalPssKiB = (memory.totalPssKiB ?? 0) + pss;
      }
    };

    const path = launchPaths.get(pid) ?? [];
    for (const [index, ancestor] of path.entries()) {
      if (owners.get(ancestor) === 1) {
        await record(ancestor, index === path.length - 1 ? "launcher" : "other");
      }
    }

    const pending: [number, Role][] = [[pid, "agent"]];
    const seen = new Set<number>();
    for (let next = pending.pop(); next; next = pending.pop()) {
      const [current, role] = next;
      if (seen.has(current)) continue;
      seen.add(current);
      await record(current, role);
      const parent = rows.get(current);
      if (!parent) continue;
      for (const child of children.get(current) ?? []) {
        const row = rows.get(child);
        if (!row || row.started < parent.started || roots.has(child)) continue;
        pending.push([child, role === "mcp" || isMcp(argv(child)) ? "mcp" : "other"]);
      }
    }
    results.set(pid, memory);
  }
  return results;
}
