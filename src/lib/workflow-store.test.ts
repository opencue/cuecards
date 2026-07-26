import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertValidName,
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
  workflowsDir,
  WorkflowError,
} from "./workflow-store";

// ---------------------------------------------------------------------------
// workflowsDir — pure (env-var driven)
// ---------------------------------------------------------------------------
describe("workflowsDir", () => {
  let prior: string | undefined;

  beforeEach(() => {
    prior = process.env.CUE_WORKFLOWS_DIR;
  });

  afterEach(() => {
    if (prior === undefined) delete process.env.CUE_WORKFLOWS_DIR;
    else process.env.CUE_WORKFLOWS_DIR = prior;
  });

  test("returns CUE_WORKFLOWS_DIR when set", () => {
    process.env.CUE_WORKFLOWS_DIR = "/tmp/my-workflows";
    expect(workflowsDir()).toBe("/tmp/my-workflows");
  });

  test("falls back to resources/workflows inside repo root when env is unset", () => {
    delete process.env.CUE_WORKFLOWS_DIR;
    const dir = workflowsDir();
    expect(dir).toContain("resources");
    expect(dir).toContain("workflows");
    // Must not be an absolute path pointing elsewhere.
    expect(dir.startsWith("/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertValidName — pure validation helper
// ---------------------------------------------------------------------------
describe("assertValidName", () => {
  test("accepts a simple lowercase slug", () => {
    expect(() => assertValidName("my-workflow")).not.toThrow();
  });

  test("accepts single lowercase letter", () => {
    expect(() => assertValidName("a")).not.toThrow();
  });

  test("accepts slug starting with a digit", () => {
    expect(() => assertValidName("1-workflow")).not.toThrow();
  });

  test("accepts slug with digits and hyphens", () => {
    expect(() => assertValidName("abc-123-def")).not.toThrow();
  });

  test("accepts exactly 64 characters", () => {
    expect(() => assertValidName("a".repeat(64))).not.toThrow();
  });

  test("rejects a name with uppercase letters", () => {
    expect(() => assertValidName("My-Workflow")).toThrow(WorkflowError);
  });

  test("rejects a name with spaces", () => {
    expect(() => assertValidName("my workflow")).toThrow(WorkflowError);
  });

  test("rejects a name with dots", () => {
    expect(() => assertValidName("my.workflow")).toThrow(WorkflowError);
  });

  test("rejects an empty string", () => {
    expect(() => assertValidName("")).toThrow(WorkflowError);
  });

  test("rejects a name starting with a hyphen", () => {
    expect(() => assertValidName("-workflow")).toThrow(WorkflowError);
  });

  test("rejects a name longer than 64 characters", () => {
    expect(() => assertValidName("a".repeat(65))).toThrow(WorkflowError);
  });

  test("rejects names with path-traversal dots", () => {
    expect(() => assertValidName("../etc")).toThrow(WorkflowError);
  });

  test("rejects underscore (not in charset)", () => {
    expect(() => assertValidName("my_workflow")).toThrow(WorkflowError);
  });

  test("WorkflowError message includes the invalid name", () => {
    try {
      assertValidName("Bad Name!");
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      expect((e as WorkflowError).message).toContain("Bad Name!");
    }
  });
});

// ---------------------------------------------------------------------------
// WorkflowError — is a real Error subclass
// ---------------------------------------------------------------------------
describe("WorkflowError", () => {
  test("is an instance of Error", () => {
    expect(new WorkflowError("oops")).toBeInstanceOf(Error);
  });

  test("carries the supplied message", () => {
    expect(new WorkflowError("nope").message).toBe("nope");
  });
});

// ---------------------------------------------------------------------------
// listWorkflows / loadWorkflow / saveWorkflow — filesystem (temp-dir fixture)
// ---------------------------------------------------------------------------
describe("workflow CRUD", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cue-wf-store-"));
    process.env.CUE_WORKFLOWS_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CUE_WORKFLOWS_DIR;
  });

  // ── listWorkflows ─────────────────────────────────────────────────────
  test("listWorkflows returns [] when the directory does not exist", () => {
    // Point at a subdir that was never created.
    process.env.CUE_WORKFLOWS_DIR = join(dir, "nonexistent");
    expect(listWorkflows()).toEqual([]);
  });

  test("listWorkflows returns [] for an empty directory", () => {
    expect(listWorkflows()).toEqual([]);
  });

  test("listWorkflows skips non-JSON files", () => {
    writeFileSync(join(dir, "README.md"), "## notes");
    expect(listWorkflows()).toEqual([]);
  });

  test("listWorkflows skips corrupt JSON files gracefully", () => {
    writeFileSync(join(dir, "broken.json"), "not json {{{");
    expect(listWorkflows()).toEqual([]);
  });

  test("listWorkflows returns a summary for a valid workflow file", () => {
    const wf = {
      version: 1,
      name: "my-wf",
      title: "My Workflow",
      description: "desc",
      nodes: [{ id: "n1", kind: "trigger", ref: "", label: "Start", position: { x: 0, y: 0 } }],
      edges: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-06-01T00:00:00.000Z",
    };
    writeFileSync(join(dir, "my-wf.json"), JSON.stringify(wf));
    const list = listWorkflows();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("my-wf");
    expect(list[0]!.title).toBe("My Workflow");
    expect(list[0]!.nodeCount).toBe(1);
    expect(list[0]!.edgeCount).toBe(0);
    expect(list[0]!.updatedAt).toBe("2024-06-01T00:00:00.000Z");
  });

  test("listWorkflows sorts newest-updated first", () => {
    const make = (name: string, updatedAt: string) => ({
      version: 1,
      name,
      title: name,
      description: "",
      nodes: [],
      edges: [],
      createdAt: updatedAt,
      updatedAt,
    });
    writeFileSync(join(dir, "older.json"), JSON.stringify(make("older", "2024-01-01T00:00:00.000Z")));
    writeFileSync(join(dir, "newer.json"), JSON.stringify(make("newer", "2024-06-01T00:00:00.000Z")));
    const list = listWorkflows();
    expect(list[0]!.name).toBe("newer");
    expect(list[1]!.name).toBe("older");
  });

  // ── loadWorkflow ──────────────────────────────────────────────────────
  test("loadWorkflow returns null for a missing file", () => {
    expect(loadWorkflow("nonexistent")).toBeNull();
  });

  test("loadWorkflow returns the parsed workflow", () => {
    const wf = {
      version: 1,
      name: "test-wf",
      title: "Test",
      description: "",
      nodes: [],
      edges: [],
    };
    writeFileSync(join(dir, "test-wf.json"), JSON.stringify(wf));
    const loaded = loadWorkflow("test-wf");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test-wf");
    expect(loaded!.title).toBe("Test");
  });

  test("loadWorkflow throws WorkflowError for an invalid name", () => {
    expect(() => loadWorkflow("../evil")).toThrow(WorkflowError);
  });

  // ── saveWorkflow ──────────────────────────────────────────────────────
  test("saveWorkflow creates a new file and returns the doc", () => {
    const now = "2024-07-01T12:00:00.000Z";
    const result = saveWorkflow(
      { name: "new-wf", title: "New", description: "test", nodes: [], edges: [] },
      now,
    );
    expect(result.name).toBe("new-wf");
    expect(result.title).toBe("New");
    expect(result.version).toBe(1);
    expect(result.createdAt).toBe(now);
    expect(result.updatedAt).toBe(now);
    // File must exist.
    const onDisk = loadWorkflow("new-wf");
    expect(onDisk).not.toBeNull();
    expect(onDisk!.name).toBe("new-wf");
  });

  test("saveWorkflow preserves createdAt on update and bumps updatedAt", () => {
    const t1 = "2024-01-01T00:00:00.000Z";
    const t2 = "2024-07-01T00:00:00.000Z";
    saveWorkflow({ name: "upd-wf", title: "V1", description: "", nodes: [], edges: [] }, t1);
    const v2 = saveWorkflow({ name: "upd-wf", title: "V2", description: "", nodes: [], edges: [] }, t2);
    expect(v2.createdAt).toBe(t1);
    expect(v2.updatedAt).toBe(t2);
  });

  test("saveWorkflow fills title with name when title is absent", () => {
    const result = saveWorkflow({ name: "no-title", nodes: [], edges: [] }, "2024-01-01T00:00:00.000Z");
    expect(result.title).toBe("no-title");
  });

  test("saveWorkflow throws WorkflowError when name is missing", () => {
    expect(() => saveWorkflow({ nodes: [], edges: [] }, "2024-01-01T00:00:00.000Z")).toThrow(WorkflowError);
  });

  test("saveWorkflow throws WorkflowError for an invalid name", () => {
    expect(() =>
      saveWorkflow({ name: "Bad_Name", nodes: [], edges: [] }, "2024-01-01T00:00:00.000Z"),
    ).toThrow(WorkflowError);
  });

  test("saveWorkflow throws WorkflowError when nodes is not an array", () => {
    expect(() =>
      saveWorkflow({ name: "ok-name", nodes: "bad", edges: [] }, "2024-01-01T00:00:00.000Z"),
    ).toThrow(WorkflowError);
  });

  test("saveWorkflow throws WorkflowError when edges is not an array", () => {
    expect(() =>
      saveWorkflow({ name: "ok-name", nodes: [], edges: null }, "2024-01-01T00:00:00.000Z"),
    ).toThrow(WorkflowError);
  });

  test("saveWorkflow throws WorkflowError when input is not an object", () => {
    expect(() => saveWorkflow("not-an-object", "2024-01-01T00:00:00.000Z")).toThrow(WorkflowError);
  });

  test("saveWorkflow creates the workflows directory if it doesn't exist", () => {
    const subDir = join(dir, "nested", "workflows");
    process.env.CUE_WORKFLOWS_DIR = subDir;
    const result = saveWorkflow(
      { name: "auto-mkdir", title: "T", description: "", nodes: [], edges: [] },
      "2024-01-01T00:00:00.000Z",
    );
    expect(result.name).toBe("auto-mkdir");
  });
});
