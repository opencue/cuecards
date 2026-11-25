import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

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

function parseStat(stat: string) {
  const begin = stat.indexOf("(");
  const end = stat.lastIndexOf(")");
  if (begin === -1 || end <= begin) return null;
  // comm may contain parentheses and spaces. Fields after it start at #3.
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const started = Number(fields[19]);
  if (!Number.isSafeInteger(ppid) || !Number.isSafeInteger(started) || fields[0] === "Z") {
    return null;
  }
  return { comm: stat.slice(begin + 1, end), ppid, started };
}

export function processStat(path: string) {
  return parseStat(read(path));
}

function isLauncher(argv: string[]): boolean {
  return (
    /(?:^|\/)(?:src\/index\.ts|dist\/cue\.js|bin\/cue(?:\.mjs)?)$/.test(argv[1] ?? "") &&
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
    // A non-dumpable process's /proc directory can be owned by root even
    // when its effective UID is not. Check the kernel-reported effective UID.
    const uid = process.geteuid?.();
    const owned = async () => {
      const status = await readFile(`${dir}/status`, "utf8");
      return Number(/^Uid:[ \t]+\d+[ \t]+(\d+)[ \t]/m.exec(status)?.[1]) === uid;
    };
    if (uid === undefined || !(await owned())) return null;
    const rollup = await readFile(`${dir}/smaps_rollup`, "utf8");
    const kiB = Number(/^Pss:[ \t]+(\d+)[ \t]+kB$/m.exec(rollup)?.[1]);
    return Number.isSafeInteger(kiB) && await owned() && processStat(`${dir}/stat`)?.started === started
      ? kiB
      : null;
  } catch {
    return null;
  }
}

/** Read proportional resident memory (Linux PSS), without summing nested sessions twice. */
export async function measureSessionMemory(startTicks: ReadonlyMap<number, number>, proc = "/proc"): Promise<Map<number, SessionMemory>> {
  const results = new Map<number, SessionMemory>();
  if (!startTicks.size) return results;
  let entries: string[];
  try {
    entries = (await readdir(proc)).filter((entry) => /^\d+$/.test(entry));
  } catch {
    return results;
  }

  const rows = new Map<number, NonNullable<ReturnType<typeof processStat>>>();
  const children = new Map<number, number[]>();
  // Bound concurrent file reads and let unrelated dashboard requests proceed.
  for (let i = 0; i < entries.length; i += 16) {
    await Promise.all(entries.slice(i, i + 16).map(async (entry) => {
      const row = parseStat(await readFile(`${proc}/${entry}/stat`, "utf8").catch(() => ""));
      if (!row) return;
      const pid = Number(entry);
      rows.set(pid, row);
      const siblings = children.get(row.ppid);
      if (siblings) siblings.push(pid);
      else children.set(row.ppid, [pid]);
    }));
  }

  const roots = new Set<number>();
  for (const [pid, started] of startTicks) {
    if (rows.get(pid)?.started === started) roots.add(pid);
  }
  const argv = (pid: number) => read(`${proc}/${pid}/cmdline`).split("\0").filter(Boolean);
  const launchPaths = new Map<number, number[]>();
  // null marks ancestry shared by more than one session, not exclusive.
  const owners = new Map<number, number | null>();
  for (const pid of roots) {
    const path: number[] = [];
    let child = rows.get(pid);
    while (child && child.ppid > 1 && !roots.has(child.ppid) && !path.includes(child.ppid)) {
      const parent = rows.get(child.ppid);
      if (!parent || parent.started > child.started) break;
      path.push(child.ppid);
      if (isLauncher(argv(child.ppid))) {
        launchPaths.set(pid, path);
        for (const ancestor of path) owners.set(ancestor, owners.has(ancestor) ? null : pid);
        break;
      }
      child = parent;
    }
  }

  for (const pid of roots) {
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
    const launcher = path.at(-1);
    let top = pid;
    for (const ancestor of path) {
      if (owners.get(ancestor) === pid) top = ancestor;
    }

    const pending: [number, Role][] = [[top, top === pid ? "agent" : top === launcher ? "launcher" : "other"]];
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
        const owner = owners.get(child);
        if (!row || row.started < parent.started ||
            (roots.has(child) && child !== pid) || (owner != null && owner !== pid)) continue;
        pending.push([child, child === pid ? "agent" : role === "mcp" || isMcp(argv(child)) ? "mcp" : "other"]);
      }
    }
    results.set(pid, memory);
  }
  return results;
}
