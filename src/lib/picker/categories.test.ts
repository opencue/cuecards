import { describe, test, expect } from "bun:test";
import { COMBINE_CATEGORY_ORDER, combineCategoryOf } from "./categories";

describe("combineCategoryOf", () => {
  test("known orchestrator profiles map to 'orchestrators'", () => {
    expect(combineCategoryOf("full")).toBe("orchestrators");
    expect(combineCategoryOf("growth")).toBe("orchestrators");
    expect(combineCategoryOf("builder")).toBe("orchestrators");
  });

  test("frontend profiles map to 'frontend & design'", () => {
    expect(combineCategoryOf("frontend")).toBe("frontend & design");
    expect(combineCategoryOf("nextjs")).toBe("frontend & design");
    expect(combineCategoryOf("vite")).toBe("frontend & design");
    expect(combineCategoryOf("designer")).toBe("frontend & design");
  });

  test("backend profiles map to 'backend & infra'", () => {
    expect(combineCategoryOf("backend")).toBe("backend & infra");
    expect(combineCategoryOf("supabase")).toBe("backend & infra");
    expect(combineCategoryOf("aws")).toBe("backend & infra");
    expect(combineCategoryOf("coolify")).toBe("backend & infra");
  });

  test("content profiles map to 'content & research'", () => {
    expect(combineCategoryOf("blog-writer")).toBe("content & research");
    expect(combineCategoryOf("docs-writer")).toBe("content & research");
    expect(combineCategoryOf("marketing")).toBe("content & research");
  });

  test("commerce profiles map to 'commerce'", () => {
    expect(combineCategoryOf("medusa-dev")).toBe("commerce");
    expect(combineCategoryOf("stripe")).toBe("commerce");
  });

  test("integration profiles map to 'integrations'", () => {
    expect(combineCategoryOf("slack")).toBe("integrations");
    expect(combineCategoryOf("linear")).toBe("integrations");
  });

  test("unknown profile name falls back to 'other'", () => {
    expect(combineCategoryOf("does-not-exist")).toBe("other");
    expect(combineCategoryOf("")).toBe("other");
    expect(combineCategoryOf("UPPERCASE")).toBe("other");
  });
});

describe("COMBINE_CATEGORY_ORDER", () => {
  test("includes all expected top-level categories", () => {
    const order = COMBINE_CATEGORY_ORDER as readonly string[];
    expect(order).toContain("orchestrators");
    expect(order).toContain("content & research");
    expect(order).toContain("frontend & design");
    expect(order).toContain("backend & infra");
    expect(order).toContain("commerce");
    expect(order).toContain("integrations");
  });

  test("'other' is the last entry so unknown profiles sort last", () => {
    const order = COMBINE_CATEGORY_ORDER as readonly string[];
    expect(order[order.length - 1]).toBe("other");
  });

  test("has no duplicate entries", () => {
    const order = COMBINE_CATEGORY_ORDER as readonly string[];
    expect(new Set(order).size).toBe(order.length);
  });
});
