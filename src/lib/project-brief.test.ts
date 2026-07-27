import { describe, expect, test } from "bun:test";

import {
  BRIEF_FILE,
  buildBriefInjection,
  briefFileKey,
  GEN_END,
  GEN_START,
  MAX_LAYOUT,
  extractNotes,
  mergeBriefFile,
  parseJustRecipes,
  parseMakeTargets,
  renderBrief,
  scanBrief,
  splitBriefFile,
  type BriefProbe,
} from "./project-brief";

/**
 * Stub probe over a virtual tree. Keys are paths relative to `/repo`; a value
 * of `null` marks a directory, a string marks a file with that content.
 */
function probeOf(tree: Record<string, string | null>): BriefProbe {
  const norm = (p: string) => p.replace(/^\/repo\/?/, "").replace(/\/$/, "");
  const entriesUnder = (dir: string): string[] => {
    const prefix = dir === "" ? "" : `${dir}/`;
    const names = new Set<string>();
    for (const key of Object.keys(tree)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.length === 0) continue;
      names.add(rest.split("/")[0]!);
    }
    return [...names];
  };
  const isDir = (rel: string) =>
    tree[rel] === null || Object.keys(tree).some((k) => k.startsWith(`${rel}/`));
  return {
    exists: (p) => {
      const rel = norm(p);
      return rel in tree || isDir(rel);
    },
    read: (p) => {
      const v = tree[norm(p)];
      return typeof v === "string" ? v : null;
    },
    list: (p) => entriesUnder(norm(p)),
    listDirs: (p) => {
      const base = norm(p);
      const prefix = base === "" ? "" : `${base}/`;
      return entriesUnder(base).filter((n) => isDir(`${prefix}${n}`));
    },
  };
}

const scan = (tree: Record<string, string | null>) => scanBrief("/repo", probeOf(tree));

describe("scanBrief", () => {
  test("returns null for a directory with no manifest and no git", () => {
    expect(scan({ "notes.txt": "hi" })).toBeNull();
  });

  test("reads the package manager from the lockfile, not the ecosystem", () => {
    const bun = scan({ "package.json": "{}", "bun.lock": "" });
    expect(bun?.packageManager).toEqual({ name: "bun", via: "bun.lock" });

    const pnpm = scan({ "package.json": "{}", "pnpm-lock.yaml": "" });
    expect(pnpm?.packageManager?.name).toBe("pnpm");

    const bare = scan({ "package.json": "{}" });
    expect(bare?.packageManager).toEqual({ name: "npm", via: "package.json (no lockfile)" });
  });

  test("extracts the project's own scripts, routed through its package manager", () => {
    const brief = scan({
      "bun.lock": "",
      "package.json": JSON.stringify({
        scripts: { test: "bun test", build: "bun build src", lint: "biome lint src", typecheck: "tsc --noEmit" },
      }),
    });
    expect(brief?.commands).toEqual([
      { label: "test", command: "bun run test" },
      { label: "build", command: "bun run build" },
      { label: "lint", command: "bun run lint" },
      { label: "typecheck", command: "bun run typecheck" },
    ]);
  });

  test("falls back to Makefile and justfile targets", () => {
    const make = scan({ Makefile: "test:\n\tgo test ./...\nbuild:\n\tgo build\n" });
    expect(make?.commands).toContainEqual({ label: "test", command: "make test" });

    const just = scan({ justfile: "check:\n  cargo clippy\nrun port:\n  cargo run\n" });
    expect(just?.commands).toContainEqual({ label: "test", command: "just check" });
    expect(just?.commands).toContainEqual({ label: "dev", command: "just run" });
  });

  test("knows the ecosystem defaults for cargo, python and go", () => {
    const rust = scan({ "Cargo.toml": "[package]\nname='x'", "Cargo.lock": "" });
    expect(rust?.commands).toContainEqual({ label: "test", command: "cargo test" });
    expect(rust?.packageManager?.name).toBe("cargo");

    const py = scan({ "pyproject.toml": "[tool.pytest.ini_options]\n[tool.ruff]\n" });
    expect(py?.commands).toContainEqual({ label: "test", command: "pytest" });
    expect(py?.commands).toContainEqual({ label: "lint", command: "ruff check ." });

    const go = scan({ "go.mod": "module x" });
    expect(go?.commands).toContainEqual({ label: "test", command: "go test ./..." });
  });

  test("the first source of a label wins — no duplicate rows", () => {
    const brief = scan({
      "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      Makefile: "test:\n\tmake-test\n",
    });
    expect(brief?.commands.filter((c) => c.label === "test")).toHaveLength(1);
    expect(brief?.commands[0]?.command).toBe("npm run test");
  });

  test("collects entry points from the manifest and conventional paths", () => {
    const brief = scan({
      "package.json": JSON.stringify({ bin: { cue: "bin/cue.mjs" }, main: "dist/index.js" }),
      "src/index.ts": "",
      "cmd/server/main.go": "",
    });
    expect(brief?.entrypoints).toContain("bin/cue.mjs");
    expect(brief?.entrypoints).toContain("src/index.ts");
    expect(brief?.entrypoints.length).toBeLessThanOrEqual(4);
  });

  test("layout keeps real directories and drops build noise", () => {
    const brief = scan({
      "package.json": "{}",
      "src/a.ts": "",
      "docs/a.md": "",
      "node_modules/pkg/index.js": "",
      "dist/out.js": "",
      ".git/HEAD": "ref: refs/heads/main",
      ".next/x": "",
    });
    expect(brief?.layout).toEqual(["src", "docs"]);
  });

  test("caps the layout list and reports how many it hid", () => {
    const tree: Record<string, string | null> = { "package.json": "{}" };
    for (let i = 0; i < 20; i++) tree[`dir${String(i).padStart(2, "0")}/f.ts`] = "";
    const brief = scan(tree);
    expect(brief?.layout).toHaveLength(MAX_LAYOUT);
    expect(brief?.layoutMore).toBe(12);
    expect(renderBrief(brief!)).toContain("(+12 more)");
  });

  test("source directories outrank the alphabet in the layout budget", () => {
    const tree: Record<string, string | null> = { "package.json": "{}" };
    for (const d of ["action", "agentshield", "awesome", "content", "drafts", "evals", "web", "src", "profiles", "resources"]) {
      tree[`${d}/f.ts`] = "";
    }
    const layout = scan(tree)?.layout ?? [];
    expect(layout.slice(0, 4)).toEqual(["src", "web", "profiles", "resources"]);
    expect(layout).not.toContain("drafts");
  });

  test("reports workspaces from every monorepo dialect", () => {
    const npmWs = scan({ "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }) });
    expect(npmWs?.workspaces).toEqual(["apps/*", "packages/*"]);

    const pnpmWs = scan({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - packages/*\n",
      "turbo.json": "{}",
    });
    expect(pnpmWs?.workspaces).toEqual(["apps/*", "packages/*", "turborepo"]);
  });

  test("names the data layer when a schema is present", () => {
    const brief = scan({ "package.json": "{}", "prisma/schema.prisma": "" });
    expect(brief?.data).toEqual(["prisma (prisma/schema.prisma)"]);
  });

  test("quotes what CI actually runs, filtered and capped", () => {
    const workflow = [
      "jobs:",
      "  ci:",
      "    steps:",
      "      - run: bun install",
      "      - run: bun test",
      "      - run: bun run typecheck",
      "      - run: echo hello",
    ].join("\n");
    const brief = scan({ "package.json": "{}", ".github/workflows/ci.yml": workflow });
    expect(brief?.ci).toEqual(["bun test", "bun run typecheck"]);
  });

  test("reads the default branch from the origin ref", () => {
    const brief = scan({
      "package.json": "{}",
      ".git/refs/remotes/origin/HEAD": "ref: refs/remotes/origin/main\n",
    });
    expect(brief?.defaultBranch).toBe("main");
  });

  test("notes .env.example without ever reading a .env", () => {
    const reads: string[] = [];
    const base = probeOf({ "package.json": "{}", ".env.example": "API_KEY=", ".env": "API_KEY=sk-real" });
    const spy: BriefProbe = { ...base, read: (p) => { reads.push(p); return base.read(p); } };
    const brief = scanBrief("/repo", spy);
    expect(brief?.hasEnvExample).toBe(true);
    expect(reads.some((p) => /\.env$/.test(p))).toBe(false);
    expect(reads.some((p) => /\.env\.example$/.test(p))).toBe(false);
  });

  test("survives a manifest that is not valid JSON", () => {
    const brief = scan({ "package.json": "{ this is not json", "bun.lock": "" });
    expect(brief).not.toBeNull();
    expect(brief?.commands).toEqual([]);
  });

  test("picks up notes from an existing .cue/project.md", () => {
    const brief = scan({
      "package.json": "{}",
      [BRIEF_FILE]: `${GEN_START}\nold\n${GEN_END}\n\n## Notes\n- run migrations first\n`,
    });
    expect(brief?.notes).toEqual(["run migrations first"]);
  });
});

describe("renderBrief", () => {
  const brief = scan({
    "bun.lock": "",
    "package.json": JSON.stringify({ scripts: { test: "bun test" }, bin: { cue: "bin/cue.mjs" } }),
    "src/index.ts": "",
    "docs/x.md": "",
  })!;

  test("renders aligned facts with a header the agent can act on", () => {
    const text = renderBrief(brief);
    expect(text).toContain("## This project");
    expect(text).toContain("Prefer these commands over guesses");
    expect(text).toContain("package manager   bun (bun.lock)");
    expect(text).toContain("test              bun run test");
    expect(text).toContain("layout            src/ docs/");
  });

  test("truncates visibly instead of blowing the budget", () => {
    const text = renderBrief({ ...brief, notes: Array.from({ length: 200 }, (_, i) => `note ${i}`) });
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text).toContain("(brief truncated)");
  });

  test("an empty brief renders nothing at all", () => {
    expect(
      renderBrief({
        root: "/repo",
        commands: [],
        entrypoints: [],
        layout: [],
        layoutMore: 0,
        workspaces: [],
        data: [],
        ci: [],
        hasEnvExample: false,
        notes: [],
      }),
    ).toBe("");
  });
});

describe(".cue/project.md handling", () => {
  test("splits the generated block from everything else", () => {
    const file = `${GEN_START}\nmachine\n${GEN_END}\n\n## Notes\n- a\n`;
    const { generated, rest } = splitBriefFile(file);
    expect(generated).toBe("machine");
    expect(rest).toContain("## Notes");
  });

  test("a file without markers is treated as all notes — never overwritten", () => {
    const { generated, rest } = splitBriefFile("## Notes\n- hand written\n");
    expect(generated).toBe("");
    expect(rest).toContain("hand written");
  });

  test("merging replaces only the machine block", () => {
    const existing = `${GEN_START}\nOLD FACTS\n${GEN_END}\n\n## Notes\n- keep me\n`;
    const merged = mergeBriefFile(existing, "NEW FACTS");
    expect(merged).toContain("NEW FACTS");
    expect(merged).not.toContain("OLD FACTS");
    expect(merged).toContain("- keep me");
  });

  test("merging is idempotent", () => {
    const once = mergeBriefFile(null, "FACTS");
    const twice = mergeBriefFile(once, "FACTS");
    expect(twice).toBe(mergeBriefFile(twice, "FACTS"));
    expect(twice.match(new RegExp(GEN_START, "g"))).toHaveLength(1);
  });

  test("a new file ships with a notes template", () => {
    const fresh = mergeBriefFile(null, "FACTS");
    expect(fresh).toContain("## Notes");
    expect(fresh).toContain("FACTS");
  });

  test("extractNotes reads bullets under any Notes heading and ignores prose", () => {
    const file = "## Notes\nsome prose\n- first\n* second\n\n## Other\n- ignored\n";
    expect(extractNotes(file)).toEqual(["first", "second"]);
  });
});

describe("manifest parsers", () => {
  test("Makefile targets skip variables and recipe bodies", () => {
    const targets = parseMakeTargets("VAR := 1\ntest:\n\techo hi\n.PHONY: test\nbuild: test\n\techo\n");
    expect(targets).toContain("test");
    expect(targets).toContain("build");
    expect(targets).not.toContain("VAR");
  });

  test("justfile recipes tolerate parameters", () => {
    expect(parseJustRecipes("check:\n  x\nrun port='3000':\n  y\n")).toEqual(["check", "run"]);
  });
});

describe("buildBriefInjection", () => {
  const brief = "## This project\n\ntest  bun run test";

  test("claude-code gets the brief inline as a system-prompt append", () => {
    const out = buildBriefInjection({
      agent: "claude-code",
      brief,
      briefDir: "/cfg/briefs",
      cwd: "/repo",
    });
    expect(out.args).toEqual(["--append-system-prompt", brief]);
    expect(out.env).toEqual({});
    expect(out.file).toBeUndefined();
  });

  test("codex gets a per-directory file plus a pointer env var", () => {
    const out = buildBriefInjection({ agent: "codex", brief, briefDir: "/cfg/briefs", cwd: "/repo" });
    expect(out.args).toEqual([]);
    expect(out.file?.path).toBe(`/cfg/briefs/${briefFileKey("/repo")}.md`);
    expect(out.file?.content).toBe(`${brief}\n`);
    expect(out.env.CUE_PROJECT_BRIEF).toBe(out.file?.path);
  });

  test("different directories never share a brief file", () => {
    const a = buildBriefInjection({ agent: "codex", brief, briefDir: "/cfg/briefs", cwd: "/repo/a" });
    const b = buildBriefInjection({ agent: "codex", brief, briefDir: "/cfg/briefs", cwd: "/repo/b" });
    expect(a.file?.path).not.toBe(b.file?.path);
    // …and the same directory always resolves to the same file.
    expect(briefFileKey("/repo/a")).toBe(briefFileKey("/repo/a"));
  });

  test("an empty brief injects nothing at all", () => {
    for (const agent of ["claude-code", "codex"]) {
      const out = buildBriefInjection({ agent, brief: "   ", briefDir: "/cfg/briefs", cwd: "/repo" });
      expect(out).toEqual({ args: [], env: {} });
    }
  });
});

describe("notes never leak into the generated block", () => {
  test("renderBrief can omit notes, and a rewrite stays idempotent", () => {
    const brief = scan({ "package.json": "{}" })!;
    const withNotes = { ...brief, notes: ["migrations first"] };
    expect(renderBrief(withNotes)).toContain("migrations first");
    expect(renderBrief(withNotes, { includeNotes: false })).not.toContain("migrations first");

    const machine = renderBrief(withNotes, { includeNotes: false });
    const once = mergeBriefFile(null, machine);
    const withUserNote = `${once}\n- migrations first\n`;
    const twice = mergeBriefFile(withUserNote, machine);
    expect(splitBriefFile(twice).generated).not.toContain("migrations first");
    expect(twice).toContain("- migrations first");
  });
});
