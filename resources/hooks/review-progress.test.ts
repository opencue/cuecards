import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const EMIT = join(REPO, "bin", "cue-review-progress");
const AUTO_REVIEW = join(import.meta.dir, "auto-review.sh");

let home: string;

function run(bin: string, args: string[], env: Record<string, string> = {}, input = "") {
  const r = spawnSync("bash", [bin, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

async function progressEvents(): Promise<any[]> {
  const dir = join(home, ".config", "cue", "review-progress");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const out: any[] = [];
  for (const f of files) {
    const raw = await readFile(join(dir, f), "utf8");
    for (const l of raw.split("\n").filter(Boolean)) out.push(JSON.parse(l));
  }
  return out;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cue-rp-home-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("cue-review-progress emitter", () => {
  test("start → emit → end writes valid JSONL and a latest pointer", async () => {
    const id = run(EMIT, ["start", "--label", "tracker PR", "--files", "8"]).stdout.trim();
    expect(id).toMatch(/^rev-/);
    run(EMIT, ["emit", "--kind", "file", "--file", "tracker.html"]);
    run(EMIT, ["emit", "--kind", "dim", "--file", "tracker.html", "--dim", "injection"]);
    run(EMIT, ["emit", "--kind", "finding", "--file", "tracker.html", "--dim", "injection", "--severity", "HIGH", "--title", "innerHTML XSS"]);
    run(EMIT, ["end", "--summary", "1 HIGH"]);

    const ev = await progressEvents();
    // every line is valid JSON (the readFile/JSON.parse above would throw otherwise)
    expect(ev.find((e) => e.kind === "start")?.title).toBe("tracker PR");
    expect(ev.find((e) => e.kind === "finding")?.severity).toBe("HIGH");
    expect(ev.find((e) => e.kind === "finding")?.title).toBe("innerHTML XSS");
    expect(ev.at(-1)?.kind).toBe("end");

    const latest = (await readFile(join(home, ".config", "cue", "review-progress", "latest"), "utf8")).trim();
    expect(latest).toBe(id);
  });

  test("emit rejects an invalid --kind", () => {
    run(EMIT, ["start"]);
    const r = run(EMIT, ["emit", "--kind", "bogus"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("invalid --kind");
  });

  test("control chars in a title can't corrupt the JSONL", async () => {
    run(EMIT, ["start"]);
    run(EMIT, ["emit", "--kind", "note", "--title", "tab\there\nnewline"]);
    const ev = await progressEvents(); // JSON.parse in the loop is the assertion
    expect(ev.some((e) => e.kind === "note")).toBe(true);
  });
});

// ── auto-review integration: the hook routes PROGRESS/FOUND to the live log ──
function gitRepo(): string {
  const repo = spawnSync("mktemp", ["-d"], { encoding: "utf8" }).stdout.trim();
  const git = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@t.test"]);
  git(["config", "user.name", "t"]);
  spawnSync("bash", ["-c", `printf 'one\\n' > "${repo}/f.js"`]);
  git(["add", "."]);
  git(["commit", "-qm", "base"]);
  spawnSync("bash", ["-c", `printf 'two has a bug\\n' > "${repo}/f.js"`]); // uncommitted diff
  return repo;
}

function runAutoReview(repo: string, reviewerCmd: string) {
  const payload = JSON.stringify({ transcript_path: "", cwd: repo, stop_hook_active: false });
  const r = spawnSync("bash", [AUTO_REVIEW], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, HOME: home, CUE_AUTO_REVIEW_CMD: reviewerCmd },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

describe("auto-review live progress integration", () => {
  test("a blocking review streams dim+finding events AND still blocks", async () => {
    await mkdir(join(home, ".config", "cue"), { recursive: true });
    await writeFile(join(home, ".config", "cue", "auto-review-enabled"), "");
    const repo = gitRepo();
    // Reviewer: live PROGRESS + FOUND, then the canonical HIGH: verdict bullet.
    const stub = `cat >/dev/null; printf 'PROGRESS: f.js | logic\\nFOUND: HIGH | f.js:1 | off-by-one\\nHIGH: off-by-one bug\\n'`;
    const r = runAutoReview(repo, stub);
    expect(r.stdout).toContain('"decision":"block"'); // verdict still enforced
    const ev = await progressEvents();
    expect(ev.some((e) => e.kind === "dim" && e.file === "f.js")).toBe(true);
    expect(ev.some((e) => e.kind === "finding" && e.severity === "HIGH" && e.title === "off-by-one")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  test("a clean review streams progress but does not block", async () => {
    await mkdir(join(home, ".config", "cue"), { recursive: true });
    await writeFile(join(home, ".config", "cue", "auto-review-enabled"), "");
    const repo = gitRepo();
    const stub = `cat >/dev/null; printf 'PROGRESS: f.js | logic\\nREVIEW_CLEAN\\n'`;
    const r = runAutoReview(repo, stub);
    expect(r.stdout).not.toContain("block");
    const ev = await progressEvents();
    expect(ev.some((e) => e.kind === "dim")).toBe(true);
    expect(ev.some((e) => e.kind === "end")).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });
});
