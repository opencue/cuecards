import { describe, expect, test } from "bun:test";

import {
  buildPaletteRows,
  filterRows,
  fuzzyScore,
  MATCHES_SECTION,
  renderPaletteFrame,
  DETECTED_SECTION,
  FEATURED_SECTION,
  FREQUENT_SECTION,
  SUGGESTED_SECTION,
  type PaletteProfile,
  type PaletteRow,
} from "./palette";
import { displayWidth } from "./render-util";
import type { ProfileTally } from "./tally";

const profiles: PaletteProfile[] = [
  { value: "rust", label: "🦀 rust", hint: "systems" },
  { value: "rust-core", label: "rust-core", hint: "core crates" },
  { value: "secops", label: "🔒 secops", hint: "security" },
  { value: "python", label: "🐍 python", hint: "scripts" },
  { value: "medusa-next", label: "medusa-next", conflicts: ["medusa-vite"] },
  { value: "medusa-vite", label: "medusa-vite" },
  { value: "full", label: "full", hint: "everything" },
];

const rows = (over: Partial<PaletteRow>[] = []): PaletteRow[] => [
  { value: "rust", label: "🦀 rust", section: SUGGESTED_SECTION, recommended: true },
  { value: "secops", label: "🔒 secops", section: SUGGESTED_SECTION, recommended: true },
  { value: "medusa-next", label: "medusa-next", section: "commerce", conflicts: ["medusa-vite"] },
  { value: "medusa-vite", label: "medusa-vite", section: "commerce" },
  ...(over as PaletteRow[]),
];

/** styleText only emits escapes when stdout is a TTY, which varies by runner. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const plain = (s: string) => s.replace(ANSI, "");

const tally = (id: string, skills: number, alwaysOn = 0): ProfileTally => ({
  skills: Array.from({ length: skills }, (_, i) => `${id}:s${i}`),
  mcps: [],
  plugins: [],
  commands: [],
  alwaysOn,
});

describe("fuzzyScore", () => {
  test("ranks exact over prefix over substring over subsequence", () => {
    const exact = fuzzyScore("rust", "rust")!;
    const prefix = fuzzyScore("rust", "rust-core")!;
    const substring = fuzzyScore("core", "rust-core")!;
    const subseq = fuzzyScore("rc", "rust-core")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
  });

  test("finds initials across a hyphen (the classic prefix search could not)", () => {
    expect(fuzzyScore("rc", "rust-core")).not.toBeNull();
    expect(fuzzyScore("mn", "medusa-next")).not.toBeNull();
  });

  test("returns null when the characters are not in order", () => {
    expect(fuzzyScore("zz", "rust")).toBeNull();
    expect(fuzzyScore("tsur", "rust")).toBeNull();
  });

  test("an empty query matches everything neutrally", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("filterRows", () => {
  test("passes rows through untouched when the query is empty", () => {
    const all = rows();
    expect(filterRows(all, "")).toBe(all);
    expect(filterRows(all, "   ")).toBe(all);
  });

  test("ranks matches into one flat section", () => {
    const out = filterRows(rows(), "me");
    expect(out.every((r) => r.section === MATCHES_SECTION)).toBe(true);
    expect(out.map((r) => r.value)).toEqual(["medusa-next", "medusa-vite"]);
  });

  test("matches on the label as well as the value", () => {
    const out = filterRows(rows(), "🦀");
    expect(out.map((r) => r.value)).toEqual(["rust"]);
  });

  test("returns nothing for a query that matches nothing", () => {
    expect(filterRows(rows(), "zzzz")).toEqual([]);
  });
});

describe("buildPaletteRows", () => {
  test("orders sections and lists every profile exactly once", () => {
    const out = buildPaletteRows({
      profiles,
      suggested: ["rust", "secops"],
      detected: [{ name: "python", confidence: 0.8, reasons: ["pyproject.toml"] }],
      recents: [{ name: "medusa-next", sessions: 3 }],
      featured: ["rust-core"],
    });
    expect(out.map((r) => r.value)).toHaveLength(profiles.length);
    expect(new Set(out.map((r) => r.value)).size).toBe(profiles.length);
    const sectionOf = (v: string) => out.find((r) => r.value === v)?.section;
    expect(sectionOf("rust")).toBe(SUGGESTED_SECTION);
    expect(sectionOf("python")).toBe(DETECTED_SECTION);
    expect(sectionOf("medusa-next")).toBe(FREQUENT_SECTION);
    expect(sectionOf("rust-core")).toBe(FEATURED_SECTION);
    // Anything unclaimed falls into its category bucket.
    expect(sectionOf("medusa-vite")).toBe("commerce");
  });

  test("marks the suggested stack and carries detection reasons as hints", () => {
    const out = buildPaletteRows({
      profiles,
      suggested: ["rust"],
      detected: [{ name: "python", confidence: 0.8, reasons: ["pyproject.toml", "manage.py", "x"] }],
    });
    expect(out.find((r) => r.value === "rust")?.recommended).toBe(true);
    expect(out.find((r) => r.value === "python")?.hint).toBe("pyproject.toml, manage.py");
  });

  test("the first section claims a profile that several sources offer", () => {
    const out = buildPaletteRows({
      profiles,
      suggested: ["python"],
      detected: [{ name: "python", confidence: 0.9, reasons: ["pyproject.toml"] }],
      recents: [{ name: "python", sessions: 9 }],
    });
    expect(out.filter((r) => r.value === "python")).toHaveLength(1);
    expect(out.find((r) => r.value === "python")?.section).toBe(SUGGESTED_SECTION);
  });

  test("splits composite recents into their parts", () => {
    const out = buildPaletteRows({
      profiles,
      suggested: [],
      recents: [{ name: "rust+secops", sessions: 2 }],
    });
    expect(out.find((r) => r.value === "rust")?.section).toBe(FREQUENT_SECTION);
    expect(out.find((r) => r.value === "secops")?.section).toBe(FREQUENT_SECTION);
  });

  test("tags the kitchen-sink profile as dangerous", () => {
    const out = buildPaletteRows({ profiles, suggested: [] });
    expect(out.find((r) => r.value === "full")?.danger).toBe("never use this");
  });
});

describe("renderPaletteFrame", () => {
  const base = { cursor: 0, query: "", cols: 80, ascii: false };

  test("shows selection marks and an uppercase section header", () => {
    const frame = plain(renderPaletteFrame({ ...base, rows: rows(), selected: ["rust"] }));
    expect(frame).toContain(SUGGESTED_SECTION.toUpperCase());
    expect(frame).toContain("● 🦀 rust");
    expect(frame).toContain("○ 🔒 secops");
    // The section header already says "suggested" — the per-row tag would only
    // repeat it, so it stays off until a search flattens the sections away.
    expect(frame).not.toContain("  suggested");
  });

  test("tags a suggested row once a search has flattened the sections", () => {
    const frame = plain(
      renderPaletteFrame({ ...base, rows: rows(), selected: [], query: "rust" }),
    );
    expect(frame).toContain(MATCHES_SECTION.toUpperCase());
    expect(frame).toContain("suggested");
  });

  test("reports how much is on screen next to the search field", () => {
    const frame = plain(renderPaletteFrame({ ...base, rows: rows(), selected: ["rust"] }));
    expect(frame).toContain("type to filter…");
    expect(frame).toContain("4 profiles");
    expect(frame).toContain("1 selected");
    const searching = plain(
      renderPaletteFrame({ ...base, rows: rows(), selected: [], query: "medusa" }),
    );
    expect(searching).toContain("2 matches");
    expect(searching).toContain("none selected");
  });

  test("disables a row that conflicts with the selection and says why", () => {
    const frame = renderPaletteFrame({ ...base, rows: rows(), selected: ["medusa-next"] });
    expect(plain(frame)).toContain("⊘");
    expect(plain(frame)).toContain("conflicts with medusa-next");
  });

  test("footer totals the selected stack, meters it and flags a heavy one", () => {
    const tallies = new Map([
      ["rust", tally("rust", 20, 4000)],
      ["secops", tally("secops", 11, 9000)],
    ]);
    const frame = plain(
      renderPaletteFrame({ ...base, rows: rows(), selected: ["rust", "secops"], tallies }),
    );
    expect(frame).toContain("🦀 rust  +  🔒 secops");
    expect(frame).toContain("31 skills");
    expect(frame).toContain("~13k always-on");
    expect(frame).toContain("⚠ heavy, slows the agent");
    expect(frame).toContain("█");
    expect(frame).toContain("⏎ launch 2");
  });

  test("marks totals as pending while a tally is still loading", () => {
    const frame = renderPaletteFrame({
      ...base,
      rows: rows(),
      selected: ["rust", "secops"],
      tallies: new Map([["rust", tally("rust", 20)]]),
    });
    expect(plain(frame)).toContain("20 skills …");
  });

  test("nudges when nothing is selected", () => {
    const frame = plain(renderPaletteFrame({ ...base, rows: rows(), selected: [] }));
    expect(frame).toContain("nothing selected yet — press space to add the focused profile");
    expect(frame).toContain("⏎ pick a profile");
  });

  test("the action row sheds words instead of wrapping a narrow terminal", () => {
    for (const cols of [40, 56, 60, 72, 80, 120]) {
      const frame = plain(
        renderPaletteFrame({ ...base, cols, rows: rows(), selected: ["rust"], maxRows: 6 }),
      );
      for (const line of frame.split("\n")) expect(displayWidth(line)).toBeLessThanOrEqual(cols);
      // However narrow it gets, the two keys you cannot guess still show.
      expect(frame).toContain("⏎ launch 1");
      expect(frame).toContain("space add");
    }
  });

  test("windows a long list with scroll markers", () => {
    const many: PaletteRow[] = Array.from({ length: 40 }, (_, i) => ({
      value: `p${i}`,
      label: `p${i}`,
      section: "other",
    }));
    const frame = renderPaletteFrame({ ...base, rows: many, selected: [], cursor: 20, maxRows: 6 });
    expect(frame).toContain("↑ ");
    expect(frame).toContain("↓ ");
    expect(frame).toContain("more");
  });

  test("reports an empty search instead of an empty screen", () => {
    const frame = renderPaletteFrame({ ...base, rows: rows(), selected: [], query: "zzz" });
    expect(frame).toContain('nothing matches "zzz"');
  });

  test("help overlay replaces the list", () => {
    const frame = renderPaletteFrame({ ...base, rows: rows(), selected: [], help: true });
    expect(frame).toContain("add / remove the focused profile");
    expect(frame).toContain("back to the suggestion");
    expect(plain(frame)).not.toContain("○");
  });

  test("ascii mode drops the emoji icons and keeps bracket checkboxes", () => {
    const frame = renderPaletteFrame({ ...base, rows: rows(), selected: ["rust"], ascii: true });
    expect(plain(frame)).toContain("[x] rust");
    expect(plain(frame)).toContain("[ ] secops");
    expect(frame).not.toContain("🦀");
  });
});

describe("row width discipline", () => {
  test("clips a long cursor hint instead of wrapping the row", () => {
    const long = "x".repeat(400);
    const frame = renderPaletteFrame({
      rows: [{ value: "rust", label: "🦀 rust", hint: long, section: "other" }],
      query: "",
      cursor: 0,
      selected: [],
      cols: 80,
      ascii: false,
    });
    for (const line of plain(frame).split("\n")) expect(line.length).toBeLessThanOrEqual(80);
    expect(frame).toContain("…");
  });

  test("weak detections stay in the catalogue instead of the detected section", () => {
    const out = buildPaletteRows({
      profiles,
      suggested: [],
      detected: [
        { name: "python", confidence: 0.8, reasons: ["pyproject.toml"] },
        { name: "full", confidence: 0.3, reasons: ["a stray file"] },
      ],
    });
    expect(out.find((r) => r.value === "python")?.section).toBe(DETECTED_SECTION);
    expect(out.find((r) => r.value === "full")?.section).not.toBe(DETECTED_SECTION);
  });
});
