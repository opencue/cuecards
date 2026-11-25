import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { searchForkSkills } from "../../web/src/skill-catalog";
import { configDir } from "./config-paths";

type CatalogSkill = Pick<ReturnType<typeof searchForkSkills>[number], "id" | "repo" | "directory" | "commit">;
type Snapshot = Pick<CatalogSkill, "repo" | "directory"> & {
  current: string;
  previous?: string;
  held?: string;
};
type UpdateResult = { id: string; commit?: string; error?: string };

const slug = /^[a-z\d]+(?:-[a-z\d]+)*$/;
const sha = /^[a-f0-9]{40}$/;
const repoName = /^NagyVikt\/[a-zA-Z\d-]+$/;
const stateFile = "selection.json";

function fetchSnapshot(skill: CatalogSkill, dest: string): void {
  if ((process.env.CUE_OFFLINE ?? process.env.SOUL_OFFLINE) === "1") {
    throw new Error("Cannot download a catalog snapshot in offline mode");
  }
  const gitDir = join(dirname(dest), "git");
  const git = (...args: string[]) => execFileSync("git", ["--git-dir", gitDir, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  git("init", "--bare", "--template=");
  try {
    git("fetch", "--depth=1", "--no-tags", `https://github.com/${skill.repo}.git`, skill.commit);
  } catch {
    throw new Error(`Unable to download ${skill.repo}@${skill.commit}`);
  }
  if (git("rev-parse", "FETCH_HEAD").toString().trim() !== skill.commit) {
    throw new Error("Git did not fetch the exact catalog commit");
  }

  const prefix = `${skill.directory}/`;
  const tree = git("ls-tree", "-rz", skill.commit, "--", prefix).toString().split("\0");
  for (const item of tree.filter(Boolean)) {
    const tab = item.indexOf("\t");
    const meta = item.slice(0, tab);
    const path = item.slice(tab + 1);
    const blob = /^100644 blob ([a-f0-9]{40})$/.exec(meta)?.[1];
    const rel = path.slice(prefix.length);
    if (!blob || !path.startsWith(prefix) || !rel.endsWith(".md")
      || rel.split("/").some(part => !part || part === "." || part === ".." || part.includes("\\"))) {
      throw new Error(`Catalog snapshot must contain only regular Markdown files: ${skill.id}`);
    }
    const file = join(dest, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, git("cat-file", "blob", blob), { flag: "wx" });
  }
}

export function createCatalogSkillStore(
  root = join(configDir(), "catalog-skills"),
  catalog: readonly CatalogSkill[] = searchForkSkills(),
  fetch: (skill: CatalogSkill, dest: string) => void = fetchSnapshot,
) {
  const snapshotPath = (id: string, commit: string) => join(root, id, commit);
  const selectionPath = (id: string) => join(root, id, stateFile);

  function readSelection(id: string): Snapshot | undefined {
    let state: Snapshot;
    try {
      state = JSON.parse(readFileSync(selectionPath(id), "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    if (!state || !repoName.test(state.repo) || state.directory !== `skills/${id}`
      || !sha.test(state.current) || (state.previous !== undefined && !sha.test(state.previous))
      || (state.held !== undefined && !sha.test(state.held))) {
      throw new Error(`Invalid saved catalog selection for ${id}`);
    }
    return state;
  }

  function candidate(id: string): CatalogSkill {
    const item = catalog.find(entry => entry.id === id);
    if (!item || !slug.test(id) || !repoName.test(item.repo)
      || item.directory !== `skills/${id}` || !sha.test(item.commit)) {
      throw new Error(`No approved catalog revision for ${id}`);
    }
    return item;
  }

  function checkSnapshot(dir: string): void {
    if (!lstatSync(dir).isDirectory() || !lstatSync(join(dir, "SKILL.md")).isFile()) {
      throw new Error("Catalog snapshot is missing a regular SKILL.md");
    }
  }

  // One atomic selection file is the commit point. Immutable content stays
  // available to both a rollback and any runtime that still links to it.
  function select(id: string, state: Snapshot, previous?: Snapshot, skill?: CatalogSkill): void {
    const folder = join(root, id);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stage = mkdtempSync(join(folder, ".stage-"));
    try {
      const dest = snapshotPath(id, state.current);
      if (!existsSync(dest) && skill) {
        const content = join(stage, "content");
        fetch(skill, content);
        checkSnapshot(content);
        try {
          renameSync(content, dest);
        } catch (err) {
          if (!existsSync(dest)) throw err;
        }
      }
      checkSnapshot(dest);
      const stagedState = join(stage, stateFile);
      writeFileSync(stagedState, JSON.stringify(state) + "\n", { mode: 0o600 });
      // Lock only the compare-and-rename, not the potentially slow download.
      const lock = join(folder, ".selection-lock");
      try {
        mkdirSync(lock);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        throw new Error(`Catalog selection is busy for ${id}; retry the command`);
      }
      try {
        if (JSON.stringify(readSelection(id)) !== JSON.stringify(previous)) {
          throw new Error(`Catalog selection changed for ${id}; retry the command`);
        }
        renameSync(stagedState, selectionPath(id));
      } finally {
        rmdirSync(lock);
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  return {
    install(id: string): string {
      const item = candidate(id);
      const previous = readSelection(id);
      if (previous) return previous.current;
      select(id, { repo: item.repo, directory: item.directory, current: item.commit }, undefined, item);
      return item.commit;
    },
    update(): UpdateResult[] {
      if (!existsSync(root)) return [];
      const results: UpdateResult[] = [];
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const id = entry.name;
        if (!entry.isDirectory() || !slug.test(id)) continue;
        try {
          const state = readSelection(id);
          if (!state) continue;
          const item = candidate(id);
          if (state.repo !== item.repo || state.directory !== item.directory) {
            throw new Error(`Catalog provenance changed for ${id}; keeping the current revision`);
          }
          if ([state.current, state.previous, state.held].includes(item.commit)) continue;
          select(id, {
            repo: state.repo,
            directory: state.directory,
            current: item.commit,
            previous: state.current,
          }, state, item);
          results.push({ id, commit: item.commit });
        } catch (err) {
          results.push({ id, error: (err as Error).message });
        }
      }
      return results;
    },
    rollback(id: string): string {
      if (!slug.test(id)) throw new Error("Invalid catalog skill ID");
      const state = readSelection(id);
      if (!state?.previous) throw new Error(`No previous catalog snapshot for ${id}`);
      select(id, {
        repo: state.repo,
        directory: state.directory,
        current: state.previous,
        held: state.current,
      }, state);
      return state.previous;
    },
    source(ref: string): string | undefined {
      if (!ref.startsWith("catalog/")) return;
      const id = ref.slice("catalog/".length);
      if (!slug.test(id)) return;
      const state = readSelection(id);
      if (!state) return;
      const dir = snapshotPath(id, state.current);
      checkSnapshot(dir);
      return dir;
    },
  };
}
