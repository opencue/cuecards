import { expect, test } from "bun:test";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { parseHomeSearch, parseProfileId, parseStudioView, parseWorkspaceSearch } from "./route-search";

test("studio deep links accept supported views and reject arbitrary values", () => {
  expect(parseStudioView("inventory")).toBe("inventory");
  expect(parseStudioView("dashboard")).toBe("dashboard");
  expect(parseStudioView("__proto__")).toBeUndefined();
  expect(parseStudioView(["api"])).toBeUndefined();
});
test("workspace URLs reject malformed or non-UUID IDs", () => {
  expect(parseWorkspaceSearch({workspace:"1975ee71-0ef7-44be-922e-5384e7d51651"}).workspace).toBe("1975ee71-0ef7-44be-922e-5384e7d51651");
  expect(parseWorkspaceSearch({workspace:"------------------------------------"}).workspace).toBeUndefined();
});

test("only Marketplace URLs accept bounded search and allowlisted filters", () => {
  expect(parseHomeSearch({ view: "market", task: "ship", q: " deployment ", type: "bundled" }))
    .toEqual({ view: "market", task: "ship", q: " deployment ", type: "bundled" });
  expect(parseHomeSearch({ view: "inventory", task: "ship", q: "ops" })).toEqual({ view: "inventory" });
  expect(parseHomeSearch({ view: "market", task: "__proto__", q: ["ops"], type: "private" })).toEqual({ view: "market" });
  expect(parseHomeSearch({ view: "market", q: "x".repeat(121) })).toEqual({ view: "market" });
});

test("public profile IDs are bounded safe slugs", () => {
  expect(parseProfileId("aas-architecture")).toBe("aas-architecture");
  for (const id of ["../core", "builder; exit", "OPS", "a".repeat(81)]) expect(parseProfileId(id)).toBeUndefined();
});

test("TanStack search merges cannot restore rejected Marketplace filters", () => {
  const root = createRootRoute();
  const home = createRoute({ getParentRoute: () => root, path: "/", validateSearch: parseHomeSearch });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: [`/?view=market&task=unknown&type=private&q=${"x".repeat(121)}`] }),
  });
  const search = router.matchRoutes(router.state.location).at(-1)?.search;
  expect(search).toMatchObject({ view: "market", task: undefined, type: undefined, q: undefined });
});
