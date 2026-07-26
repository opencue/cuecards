# Dead-code report (generated, report only — nothing deleted)

Total findings: 85 — estimated 2587 lines.

## Area: commands

dynamic-reference check: true

### src/commands/discover.ts:1783 — `buildGemBadgeSvg`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 196
- evidence: grep -rn "buildGemBadgeSvg" src/ --include="*.ts" | grep -v "discover\.ts" → empty; only declaration line returned when including discover.ts itself
- risk: None detected — no callers in production code, tests, resources/, profiles/, or skills YAML. SVG badge generator with no hook in the discover command's live render path.

### src/commands/discover.ts:524 — `PROFILE_KEYWORDS`
- kind: duplicate-implementation
- confidence: **low**
- est. lines: 16
- evidence: grep -rn "^export const PROFILE_KEYWORDS" src/ --include="*.ts" → src/commands/discover.ts:524 and src/commands/ai.ts:29 both export PROFILE_KEYWORDS with type Record<string,string[]>. Contents verified different: discover.ts uses repo-topic keyword sets (19 profiles, longer keyword lists); ai.ts uses conversation-context keyword sets (21 profiles, shorter phrase-oriented lists). profile-names.test.ts imports both as PROFILE_KEYWORDS and AI_KEYWORDS separately.
- risk: Intentionally separate keyword sets serving different matching contexts (GitHub repo profiling vs. conversation context). Merging would require rethinking the different vocabulary choices per context.

### src/commands/cloud.ts:255 — `run() outer default`
- kind: dead-branch
- confidence: **medium**
- est. lines: 12
- evidence: src/index.ts:282 dispatches `mod.run(args.slice(1))`; _index.ts registers login/push/pull/logout/whoami each pointing to `() => import("./cloud")`. Therefore `process.argv[2]` is always one of those 5 words when cloud.ts runs; outer `switch(cmd)` always matches; the `default:` block (lines 255-267, inner switch with 5 case arms plus usage stderr) is unreachable through the CLI.
- risk: Removing breaks any hypothetical direct-import caller that passes subcommand as args[0]; no such caller found in this repo. Usage stderr would also be removed — callers hitting the (currently unreachable) default would lose the hint.

### src/commands/launch.ts:489 — `computeTokenBreakdown / splitSkillBytes / tokenLevelEmoji re-export block`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 10
- evidence: grep -rn "from.*commands/launch" src/ --include="*.ts" | grep -v '\.test\.' → empty; only launch.test.ts imports these symbols from ./launch. Comment in source reads: 'Re-exported here so existing importers from "./launch" keep resolving.'
- risk: Removing breaks launch.test.ts imports. Also breaks any external consumer outside this repo that imports from `./launch` — the backward-compat shim comment implies this was a live concern at migration time.

### src/commands/skills.ts:140 — `getActiveProfileName`
- kind: duplicate-implementation
- confidence: **high**
- est. lines: 6
- evidence: grep -rn "^async function getActiveProfileName" src/commands/ → src/commands/mcps.ts:50 and src/commands/skills.ts:140 both define the identical 6-line function wrapping resolveActiveProfile(). Neither file imports the other's copy.
- risk: No logic risk — identical bodies. Consolidating into a shared lib helper requires updating both import sites.

### src/commands/mcps.ts:50 — `getActiveProfileName`
- kind: duplicate-implementation
- confidence: **high**
- est. lines: 6
- evidence: grep -rn "^async function getActiveProfileName" src/commands/ → src/commands/mcps.ts:50 and src/commands/skills.ts:140 both define the identical 6-line function wrapping resolveActiveProfile(). Neither file imports the other's copy.
- risk: No logic risk — identical bodies. Consolidating into a shared lib helper requires updating both import sites.

### src/commands/launch.ts:496 — `type SkillTokens`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: grep -rn "SkillTokens" src/ --include="*.ts" | grep "from.*commands/launch" | grep -v '\.test\.' → empty; grep for any import of SkillTokens from ./launch including tests also returned empty
- risk: Type-only export — erased at runtime. Zero callers anywhere from the launch re-export path.

### src/commands/launch.ts:497 — `type TokenBreakdown`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: grep -rn "TokenBreakdown" src/ --include="*.ts" | grep "from.*commands/launch" | grep -v '\.test\.' → empty; no import of TokenBreakdown from ./launch found anywhere including tests
- risk: Type-only export — erased at runtime. Zero callers anywhere from the launch re-export path.

### src/commands/positioning.test.ts:13 — `CLAIM`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 1
- evidence: grep -rn "from.*positioning" src/ → empty; no file imports CLAIM from positioning.test.ts. File comment states: 'These are duplicated here on purpose: the test's job is to catch a surface drifting away.'
- risk: Export is test-internal sentinel — used only within the same file's describe block. Making it non-exported has no semantic impact; the export is likely a test-authoring artifact.

### src/commands/positioning.test.ts:16 — `DESCRIPTOR`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 1
- evidence: grep -rn "from.*positioning" src/ → empty; marketplace-manifest.test.ts defines its own independent DESCRIPTOR constant rather than importing this one. File comment confirms intentional duplication.
- risk: Same as CLAIM above — test-internal sentinel with no consumers. The matching DESCRIPTOR in marketplace-manifest.test.ts (line 9) is an independent copy, not an import.

_notes:_ Checked: _index.ts string registry (all commands lazy-imported); src/index.ts dispatch flow (mod.run(args.slice(1))); bin/, scripts/, resources/, profiles/ for YAML/markdown references; dynamic sub-dispatch in profile.ts, audit.ts, replay.ts (all legitimate). Discover.ts exported functions (scoreGem, scoreGemBreakdown, suggestProfiles, isLikelySpam, hasNicheTopicSignal) that previously appeared orphaned all have internal callers within discover.ts itself — excluded as live. Test-only files docs-facts.test.ts, features-batch1.test.ts, ai-score.e2e.test.ts are standalone integration/documentation tests with no source counterpart but are intentional and excluded from report.

## Area: src/lib/*.ts where basename starts a-m (top-level only, not tui/ or picker/)

dynamic-reference check: true

### src/lib/incremental-materialize.ts — `incremental-materialize (all exports: computeSkillHash, loadManifest, saveManifest, findChangedSkills)`
- kind: unreferenced-file
- confidence: **high**
- est. lines: 81
- evidence: rg "computeSkillHash|loadManifest|saveManifest|findChangedSkills|incremental-materialize" /home/deadpool/Documents/cue/src/ /home/deadpool/Documents/cue/bin/ /home/deadpool/Documents/cue/scripts/ /home/deadpool/Documents/cue/resources/ /home/deadpool/Documents/cue/profiles/ --glob '!incremental-materialize.*' returned empty. grep -n 'cue-manifest|incrementalMaterialize|computeSkillHash' src/lib/runtime-materializer.ts also returned empty. The file was designed as an incremental materialization optimization but was never integrated.
- risk: None. No production code imports it. The test file can be deleted with it.

### src/lib/kitty-image.ts:302 — `probeKittyTerminal`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 57
- evidence: rg "probeKittyTerminal" /home/deadpool/Documents/cue/ --glob '!kitty-image.*' -l returned only kitty-image.test.ts. Internally it is called only by detectKittyTerminal (line 370), which itself has zero production callers (same grep returns only test). The entire probe/detect chain is dead.
- risk: Deleting requires also deleting detectKittyTerminal (18 lines). clearKittyImageByIdSequence IS used by launch-loader.ts — do not touch it.

### src/lib/kitty-image.ts:218 — `kittyPlaceholderLabel`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 32
- evidence: rg "kittyPlaceholderLabel" /home/deadpool/Documents/cue/ --glob '!kitty-image.*' -l returned only kitty-image.test.ts. No production caller in any source or resource file. The placeholder-mode rendering API was implemented but never wired in.
- risk: Low. Test file tests it directly; deleting breaks the test, which should also be removed.

### src/lib/kitty-image.ts:188 — `transmitKittyImage`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 30
- evidence: rg "transmitKittyImage" /home/deadpool/Documents/cue/ --glob '!kitty-image.*' -l returned only kitty-image.test.ts. Not called anywhere else inside kitty-image.ts. Part of the placeholder-mode API that was implemented but never used.
- risk: Low. Test file tests it directly; deleting requires removing the companion test.

### src/lib/analytics.ts:114 — `recordSkillUsage`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 20
- evidence: rg "recordSkillUsage" /home/deadpool/Documents/cue/ --glob '!analytics.*' -l returned only resources/hooks/skill-fire-tracker.sh — which is a COMMENT line reading '# Replaces the 50KB regex scrape in src/lib/analytics.ts:recordSkillUsage with'. The function was superseded by the shell hook and never called from any TypeScript file.
- risk: Low. The shell hook now owns this behaviour. The comment in skill-fire-tracker.sh confirms intentional replacement.

### src/lib/handoff.ts:55 — `listHandoffs`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 20
- evidence: rg "listHandoffs" /home/deadpool/Documents/cue/ --glob '!handoff.*' returned empty (zero lines). Not called internally either (grep -n 'listHandoffs' handoff.ts returns only the definition line).
- risk: Low. The function reads from ~/.config/cue/handoffs/ which is written by dead createHandoff. Deleting all four handoff CRUD functions together is the natural unit.

### src/lib/kitty-image.ts:359 — `detectKittyTerminal`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 18
- evidence: rg "detectKittyTerminal" /home/deadpool/Documents/cue/ --glob '!kitty-image.*' -l returned only kitty-image.test.ts. Called internally only by zero-caller probeKittyTerminal chain. No production caller in any file.
- risk: Low. Test-only; the isKittyTerminal export at line 80 is the production-path function (separate implementation).

### src/lib/lazy-skills.ts:68 — `generateLazyManifest`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 15
- evidence: rg "generateLazyManifest" /home/deadpool/Documents/cue/ --glob '!lazy-skills.*' returned empty. Not called internally. Note: DEFERRED_INDEX_SLUG and generateDeferredIndexSkill ARE live (dynamically imported by runtime-materializer.ts line 299); only generateLazyManifest, generateSkillStub, and isLazyEnabled are dead.
- risk: Low. Dynamic-import scan of runtime-materializer.ts confirmed it imports only generateDeferredIndexSkill from this module.

### src/lib/lazy-skills.ts:50 — `generateSkillStub`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 15
- evidence: rg "generateSkillStub" /home/deadpool/Documents/cue/ --glob '!lazy-skills.*' returned empty. Not called internally either.
- risk: Low. No callers anywhere in src/, bin/, scripts/, or resources/.

### src/lib/kitty-image.ts:250 — `clearKittyImagesSequence`
- kind: unreachable-code
- confidence: **high**
- est. lines: 13
- evidence: grep -n 'clearKittyImagesSequence' src/lib/kitty-image.ts shows only the definition (line 250) and one internal call from clearKittyImages (line 274). rg 'clearKittyImagesSequence' --glob '!kitty-image.*' returns empty. clearKittyImages itself has zero external callers (see below), making this sequence builder transitively dead.
- risk: Must confirm clearKittyImages has no callers before deleting. clearKittyImageByIdSequence (line 263) IS live in launch-loader.ts — do not confuse the two names.

### src/lib/handoff.ts:40 — `getLatestHandoff`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 9
- evidence: rg "getLatestHandoff" /home/deadpool/Documents/cue/ --glob '!handoff.*' returned empty. Not called internally. Part of the unimplemented handoff CRUD surface.
- risk: Low. See listHandoffs for deletion strategy.

### src/lib/mcp-overrides.ts:162 — `autoPruneEnabled`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 8
- evidence: grep -n 'autoPruneEnabled' src/lib/mcp-overrides.ts shows only the definition at line 162 (body: return mcpPruneMode(value) !== 'off'). rg 'autoPruneEnabled' /home/deadpool/Documents/cue/ --glob '!mcp-overrides.*' -l returned only mcp-overrides.test.ts. Not called by any production code.
- risk: Low. mcpPruneMode (which it wraps) IS used externally. Only the boolean convenience wrapper is dead.

### src/lib/handoff.ts:32 — `createHandoff`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 8
- evidence: rg "createHandoff" /home/deadpool/Documents/cue/ --glob '!handoff.*' returned empty. Not called internally.
- risk: Low. The handoffs/ directory it writes to is never read by live code either.

### src/lib/kitty-image.ts:272 — `clearKittyImages`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 7
- evidence: rg "clearKittyImages[^B]" /home/deadpool/Documents/cue/ --glob '!kitty-image.*' returned empty (pattern excludes clearKittyImagesByIdSequence). Only internal call is to clearKittyImagesSequence (also dead).
- risk: Low. clearKittyImageByIdSequence (different function, line 263) IS live — do not confuse the two.

### src/lib/handoff.ts:49 — `getHandoff`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 6
- evidence: rg "getHandoff" /home/deadpool/Documents/cue/ --glob '!handoff.*' returned empty. Not called internally.
- risk: Low. See listHandoffs.

### src/lib/lazy-skills.ts:83 — `isLazyEnabled`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 3
- evidence: rg "isLazyEnabled" /home/deadpool/Documents/cue/ --glob '!lazy-skills.*' returned empty. Not called internally.
- risk: Low.

### src/lib/conditional-skills.ts:69 — `filterConditionalSkills`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 3
- evidence: rg "filterConditionalSkills" /home/deadpool/Documents/cue/ --glob '!conditional-skills.*' returned empty — not found in any file. evaluateCondition IS imported by project-loadout.ts and runtime-materializer.ts (confirmed by separate grep).
- risk: Low. evaluateCondition (the live export in the same file) is unaffected.

### src/lib/active-sessions.ts:139 — `isAgentProcess`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "isAgentProcess" /home/deadpool/Documents/cue/ --glob '!active-sessions.*' -l returned empty. However, grep -n 'isAgentProcess' active-sessions.ts shows a call at line 191 inside listActiveSessions. The function is used internally — only the export keyword is unnecessary.
- risk: Very low. Removing the export keyword cannot break production; listActiveSessions IS live.

### src/lib/active-sessions.ts:108 — `profileFromConfigDir`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "profileFromConfigDir" /home/deadpool/Documents/cue/ --glob '!active-sessions.*' -l returned empty. Called internally at line 209. Export keyword is unnecessary.
- risk: Very low. Internal call at line 209 keeps it live.

### src/lib/active-sessions.ts:121 — `profileFromCwdPin`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "profileFromCwdPin" /home/deadpool/Documents/cue/ --glob '!active-sessions.*' -l returned empty. Called internally at line 217. Export keyword is unnecessary.
- risk: Very low. Internal call at line 217 keeps it live.

### src/lib/dashboard-server.ts:1159 — `buildTimeline`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "buildTimeline" /home/deadpool/Documents/cue/ --glob '!dashboard-server.*' -l returned only dashboard-server.test.ts. Called internally at lines 1179 and 1226 inside HTTP route handlers. Export keyword is unnecessary.
- risk: Very low. Removing export does not affect the route handlers that call it.

### src/lib/dashboard-server.ts:1281 — `semverGt`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "semverGt" /home/deadpool/Documents/cue/ --glob '!dashboard-server.*' -l returned only dashboard-server.test.ts. Called internally at line 1303 by computeVersionInfo. Export keyword is unnecessary.
- risk: Very low.

### src/lib/dashboard-server.ts:1296 — `computeVersionInfo`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "computeVersionInfo" /home/deadpool/Documents/cue/ --glob '!dashboard-server.*' -l returned only dashboard-server.test.ts. Called internally at lines 1311 and 1320. Export keyword is unnecessary.
- risk: Very low.

### src/lib/gate-status.ts:29 — `gateStatusDir`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "gateStatusDir" /home/deadpool/Documents/cue/ --glob '!gate-status.*' -l returned empty. Called internally at lines 42, 62, 81. Export keyword is unnecessary.
- risk: Very low. Internal callers are all within gate-status.ts.

### src/lib/gate-status.ts:40 — `gateStatusFile`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "gateStatusFile" /home/deadpool/Documents/cue/ --glob '!gate-status.*' -l returned empty. Called internally at line 47 by readGateStatus. Export keyword is unnecessary.
- risk: Very low.

### src/lib/mcp-overrides.ts:40 — `mcpOverridesPath`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "mcpOverridesPath" /home/deadpool/Documents/cue/ --glob '!mcp-overrides.*' -l returned only mcp-overrides.test.ts. Used internally as the default parameter in readMcpOverride (line 65) and called at line 121. Export keyword is unnecessary.
- risk: Very low. readMcpOverride is live and depends on this as a default.

### src/lib/catalog-index.ts:145 — `catalogPath`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "catalogPath" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally by buildIndex and writeIndex. Export keyword is unnecessary.
- risk: Very low.

### src/lib/catalog-index.ts:173 — `idFromSource`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "idFromSource" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally by buildIndex. Export keyword is unnecessary.
- risk: Very low.

### src/lib/catalog-index.ts:40 — `INDEX_SCHEMA_VERSION`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "INDEX_SCHEMA_VERSION" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally in buildIndex and writeIndex. Export keyword is unnecessary.
- risk: Very low.

### src/lib/catalog-index.ts:63 — `MIN_TERM_LENGTH`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "MIN_TERM_LENGTH" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally by tokenize. Export keyword is unnecessary.
- risk: Very low.

### src/lib/catalog-index.ts:57 — `MULTI_TOKEN_BONUS`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "MULTI_TOKEN_BONUS" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally by scoring logic. Export keyword is unnecessary.
- risk: Very low.

### src/lib/catalog-index.ts:60 — `SUGGEST_THRESHOLD`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "SUGGEST_THRESHOLD" /home/deadpool/Documents/cue/ --glob '!*.test.ts' --glob '!catalog-index.ts' -l returned empty. Used internally by scoring logic. Export keyword is unnecessary.
- risk: Very low.

### src/lib/cache.ts:131 — `cacheEvict`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "cacheEvict" /home/deadpool/Documents/cue/ --glob '!cache.*' -l returned only cache.test.ts. Called internally by cachePut (line 109). Export keyword is unnecessary; the test exercises it directly but it is reachable through cachePut in production.
- risk: Low. cachePut calls cacheEvict internally — keep the function, only remove the export.

### src/lib/cache.ts:48 — `MAX_CACHE_ENTRIES`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "MAX_CACHE_ENTRIES" /home/deadpool/Documents/cue/ --glob '!cache.*' -l returned only cache.test.ts. Used internally as default parameter of cacheEvict. Export keyword is unnecessary.
- risk: Very low.

### src/lib/claude-mem-env.ts:66 — `assignPorts`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "assignPorts" /home/deadpool/Documents/cue/ --glob '!claude-mem-env.*' -l returned only claude-mem-env.test.ts. Called internally by resolveClaudeMemEnv (line 121). Export keyword is unnecessary.
- risk: Very low. resolveClaudeMemEnv IS used externally; assignPorts is its internal helper.

### src/lib/claude-mem-env.ts:31 — `PortPair`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "PortPair" /home/deadpool/Documents/cue/ --glob '!claude-mem-env.*' -l returned only claude-mem-env.test.ts. Used extensively as internal type annotation. Export keyword is unnecessary.
- risk: Very low. Interface disappears at runtime.

### src/lib/claude-mem-env.ts:37 — `PortRegistry`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "PortRegistry" /home/deadpool/Documents/cue/ --glob '!claude-mem-env.*' -l returned only claude-mem-env.test.ts. Used as internal type annotation throughout the file. Export keyword is unnecessary.
- risk: Very low.

### src/lib/claude-mem-env.ts:100 — `ResolveDeps`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "ResolveDeps" /home/deadpool/Documents/cue/ --glob '!claude-mem-env.*' -l returned only claude-mem-env.test.ts. Used as parameter type annotation for resolveClaudeMemEnv. Export keyword is unnecessary.
- risk: Very low.

### src/lib/claude-mem-env.ts:172 — `EMPTY_REGISTRY`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "EMPTY_REGISTRY" /home/deadpool/Documents/cue/ --glob '!claude-mem-env.*' -l returned only claude-mem-env.test.ts. Used internally as default value in resolveClaudeMemEnv. Export keyword is unnecessary.
- risk: Very low.

### src/lib/mcp-token-estimate.ts:110 — `mcpServerTokens`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 1
- evidence: rg "mcpServerTokens" /home/deadpool/Documents/cue/ --glob '!mcp-token-estimate.*' -l returned only mcp-token-estimate.test.ts. Called internally by sumMcpTokens (line 134). sumMcpTokens, loadMcpEstimates, and budgetExceeded ARE imported externally. Export keyword is unnecessary.
- risk: Very low. sumMcpTokens (live) calls mcpServerTokens internally — keep the function, remove the export.

_notes:_ Dynamic import check: launch.ts was scanned for await import(...) calls; only pickMcps from mcp-picker.ts and readCombos from combo-history.ts are dynamically imported. runtime-materializer.ts was scanned for template-literal module paths; only generateDeferredIndexSkill from lazy-skills.ts is loaded dynamically. src/commands/_index.ts and src/index.ts were checked for string-name dispatch; no a-m lib files are referenced by command string. package.json bin surface (bin/cue.mjs) was traced — it does not reference incremental-materialize. resources/ and profiles/ YAML/markdown files were checked via rg for symbol names in the kitty-image, handoff, and lazy-skills groups; no resource file references them.

Correction to earlier analysis: mcp-picker.ts exports buildMcpRows, renderMcpFrame, McpRow, McpFrameState, McpPickInput, DEFAULT_OFF_MCPS are all used internally by the live pickMcps function — they are unnecessarily exported helpers, not deletable dead code. combo-history.ts readComboHistoryLines and comboHistoryPath are used internally by the live readCombos (dynamically imported by launch.ts) — not dead. dashboard-server.ts buildTimeline/semverGt/computeVersionInfo and active-sessions.ts isAgentProcess/profileFromConfigDir/profileFromCwdPin are all called internally — only the export keywords are dead.

## Area: src/lib/*.ts (n-z, top-level only)

dynamic-reference check: true

### src/lib/pr-poster.ts:36 — `deriveBranchName, Runner, whoami, forkRepo, cloneFork, syncForkWithUpstream, writeFilesToWorktree, commitAndPush, OpenPrResult, openPr, PostPrInput, PostPrSuccess, PostPrFailure`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 160
- evidence: grep -rn 'deriveBranchName|forkRepo|cloneFork|syncForkWithUpstream|writeFilesToWorktree|commitAndPush|\bopenPr\b|OpenPrResult|PostPrInput|PostPrSuccess|PostPrFailure' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'pr-poster\.ts' → no output. commands/marketplace.ts does 'await import("../lib/pr-poster")' but then only destructures postPrToRepo, defaultRunner, checkOptOutMarker, fetchPrState, deleteFork, FileChange. All listed symbols are implementations or types that never leave the module boundary.
- risk: These are internal sub-steps of postPrToRepo; deleting the exports (making them unexported) is safe. Deleting the functions themselves breaks postPrToRepo. No public-API exposure; dynamic import confirmed to pull only postPrToRepo and listed live symbols.

### src/lib/runtime-gc.ts:25 — `LAST_USED_MARKER, DEFAULT_GC_DAYS, RuntimeEntry, runtimeLastUsedMs, selectGcVictims, scanRuntimes, GcOptions, GcResult`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 80
- evidence: grep -rn 'scanRuntimes|selectGcVictims|runtimeLastUsedMs|RuntimeEntry|GcOptions|GcResult|LAST_USED_MARKER|DEFAULT_GC_DAYS' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'runtime-gc\.ts' → no output. commands/gc.ts imports only runGc, gcDaysFromEnv; commands/launch.ts imports only touchRuntime, maybeAutoGc. The listed symbols are used only inside runGc/maybeAutoGc bodies.
- risk: Removing the exports makes them package-internal; the implementations are load-bearing for runGc. Do not delete the implementations, only the export keyword if desired.

### src/lib/skill-compressor.ts:1 — `generateSkillIndex`
- kind: unreferenced-file
- confidence: **high**
- est. lines: 68
- evidence: grep -rn 'generateSkillIndex\|skill-compressor' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' → no output. Also checked: no 'await import.*skill-compressor' pattern anywhere in src/; 'skill-compressor' absent from src/commands/_index.ts string dispatch; no reference in resources/ YAML or markdown.
- risk: Safe to delete. Only caller is skill-compressor.test.ts. No dynamic import path found, no command registry entry.

### src/lib/webhooks.ts:1 — `fireWebhook, WebhookEvent`
- kind: unreferenced-file
- confidence: **high**
- est. lines: 58
- evidence: grep -rn 'webhooks\|fireWebhook\|WebhookEvent' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'webhooks\.ts' → no output (a 'stripe-webhooks' hit in a skills/ path is a skill name, not an import of this module). No 'await import.*webhooks' found; absent from _index.ts string dispatch.
- risk: Safe to delete. No callers exist; no dynamic import path found.

### src/lib/skill-deps.ts:56 — `topologicalSort`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 57
- evidence: grep -rn 'topologicalSort' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' → only src/lib/skill-deps.ts:56:export function topologicalSort(...). Function spans lines 56-112 (57 lines). Not called anywhere, not even within skill-deps.ts itself. commands/skills.ts imports only buildDependencyGraph and explainWhy.
- risk: Can be deleted outright; it has no callers at all. If topological ordering is ever needed, the implementation is recoverable from git.

### src/lib/resolver-local.ts — `suggest`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 42
- evidence: grep -rn '\bsuggest\b' /home/deadpool/Documents/cue/src/lib/resolver-local.ts shows calls at lines 227, 241, 245, 258 — all inside resolver-local.ts error-throw paths. grep -rn 'from.*resolver-local' /home/deadpool/Documents/cue/src --include='*.ts' | grep suggest → no matches outside the file and its test. Approximately 42 lines between definition and last internal call.
- risk: Called only inside this file's error branches. Removing the export keyword is safe. Deleting the function body would affect internal error messages produced when skill resolution is ambiguous.

### src/lib/profile-generator.ts — `assignDomain, groupAssignments, defaultSkillsRoot, _internal`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 40
- evidence: grep -rn 'assignDomain|groupAssignments|defaultSkillsRoot' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'profile-generator\.ts' → no output. _internal is an exported namespace bundling test-surface symbols; only test imports it. All three functions are called internally (assignDomain at line 462, groupAssignments at line 557, defaultSkillsRoot at line 335).
- risk: Removing export on these does not change runtime behaviour. _internal removal would break profile-generator.test.ts if that test file uses it directly.

### src/lib/resolver-npx.ts — `PinNotFound, CacheCorrupt, flattenNpxLayout, ResolveNpxOptions, ResolveNpxResult`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 40
- evidence: grep -rn 'PinNotFound|CacheCorrupt|flattenNpxLayout|ResolveNpxOptions|ResolveNpxResult' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'resolver-npx\.ts' → only hit is a comment in profile-linter.ts:673 mentioning PinNotFound as prose, not an import. All these symbols are used internally only (flattenNpxLayout called by npxFetch at line 152).
- risk: Safe to remove the exports. The profile-linter.ts comment references PinNotFound by name only in documentation prose — removing the export does not break it.

### src/lib/resolver-local.ts — `AmbiguousSkillRef, SkillNotFound, ResolveLocalOptions, _internal`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 30
- evidence: grep -rn 'AmbiguousSkillRef|SkillNotFound|ResolveLocalOptions' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'resolver-local\.ts' → no output. These error classes and the options type are exported but never imported by any consumer outside the definition file and its test.
- risk: Removing the exports is safe. The error classes ARE thrown internally by the suggest function; don't delete their definitions.

### src/lib/runtime-materializer.ts — `linkPluginCache`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 30
- evidence: grep -rn 'linkPluginCache' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'runtime-materializer\.ts' → no output. Function is called internally at lines 231 and 757 inside materializeRuntime. Approximately 30 lines of implementation.
- risk: Implementation is load-bearing for materializeRuntime; only the export keyword is superfluous.

### src/lib/skill-linter.ts — `buildPrTitle`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 20
- evidence: grep -rn 'buildPrTitle' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'skill-linter\.ts' → no output. Called internally by buildPrBody (which the summary places near line 1070). Approximately 20 lines.
- risk: Removing the export is safe. Deleting the function body would break buildPrBody (skill-linter's PR submission path).

### src/lib/skill-router.ts — `RouterOverride, RouterRenderOptions`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 20
- evidence: grep -rn 'RouterOverride|RouterRenderOptions' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'skill-router\.ts' → no output. Both are interface declarations used only inside skill-router.ts. runtime-materializer.ts imports renderRouter but not these interfaces.
- risk: Pure interface exports with no consumers; removing the export keyword has no runtime impact.

### src/lib/pack-resolver.ts:50 — `expandPacks`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 18
- evidence: grep -rn 'expandPacks' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' → only src/lib/pack-resolver.ts:50:export function expandPacks(...). Not called internally either — the file's only other export is listPacks and loadPack which are used by commands/packs.ts. expandPacks has zero callers anywhere in the codebase.
- risk: No callers at all; can be deleted entirely. If pack expansion is ever needed, this is a clean reference implementation recoverable from git.

### src/lib/skill-deps.ts:21 — `parseDependencies`
- kind: orphaned-helper
- confidence: **medium**
- est. lines: 10
- evidence: grep -rn 'parseDependencies' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'skill-deps\.ts' → no output. Function starts at line 21 and is called only at line 44 (inside buildDependencyGraph). commands/skills.ts imports buildDependencyGraph and explainWhy only.
- risk: Called internally by buildDependencyGraph; removing the export is safe. Deleting the body breaks buildDependencyGraph.

### src/lib/profile-conflicts.ts — `ConflictDeclaring`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 10
- evidence: grep -rn 'ConflictDeclaring' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'profile-conflicts\.ts' → no output. Interface declared near the top of the file. profile-conflicts.ts is consumed by stack-suggest.ts, picker/palette.ts, and picker.ts, none of which import this interface.
- risk: Pure interface with no consumers. Removing or deleting is safe.

### src/lib/ratings.ts — `getAllRatings, getScore`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 8
- evidence: grep -rn 'getAllRatings|getScore' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'ratings\.ts' → no output. commands/skills.ts imports rateSkill and getRating only.
- risk: Utility functions with no callers outside tests. Safe to remove or make unexported.

### src/lib/resolver-npx.ts — `resolveNpx`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 8
- evidence: grep -rn '\bresolveNpx\b' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'resolver-npx\.ts' → no output. This is a thin public-facing wrapper over resolveNpxDetailed; the only real caller (profile-linter.ts) imports resolveNpxDetailed directly, bypassing the wrapper entirely.
- risk: The wrapper can be deleted; profile-linter.ts is not affected since it already calls resolveNpxDetailed directly.

### src/lib/runtime-materializer.ts — `shouldIncludeSessionTelemetry`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 4
- evidence: grep -rn 'shouldIncludeSessionTelemetry' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' | grep -v 'runtime-materializer\.ts' → no output. Function is called internally at line 632 inside materializeRuntime. The test file imports it directly for unit testing.
- risk: Implementation is load-bearing for telemetry gating inside materializeRuntime. Only the export keyword is superfluous unless the test must keep it importable.

### src/lib/telemetry-redact.ts:64 — `TELEMETRY_REDACTION_MAX_LENGTH`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 1
- evidence: grep -rn 'TELEMETRY_REDACTION_MAX_LENGTH' /home/deadpool/Documents/cue/src --include='*.ts' | grep -v '\.test\.' → only src/lib/telemetry-redact.ts:64:export const TELEMETRY_REDACTION_MAX_LENGTH = MAX_PROMPT_LENGTH;. The only non-test consumer of telemetry-redact.ts is telemetry-ingest.ts, which imports only redactPrompt.
- risk: One-line re-export of an internal constant. Removing the export has no impact; deleting the line would require updating the test that asserts the value.

_notes:_ Dynamic import audit: 'await import.*skill-compressor' and 'await import.*webhooks' patterns searched across all src/ — no matches. _index.ts string dispatch checked for both module names — absent. resources/ YAML/JSON/markdown searched for both — absent. No significant commented-out code blocks found across the n-z file set (one explanatory comment in runtime-materializer.ts at line 211, not dead code). No duplicate implementations identified. Test files count as references for liveness: all findings above are exports whose only non-self caller (if any) is the paired .test.ts file.

## Area: ui-and-entry

dynamic-reference check: true

### src/lib/picker.ts:388 — `renderCombineFrame`
- kind: dead-branch
- confidence: **high**
- est. lines: 283
- evidence: grep -r 'renderCombineFrame|CombineFrameState' src/lib --include='*.ts' | grep -v picker.ts → only picker.test.ts. pickerV2Enabled() at src/lib/picker/flow.ts:36-38 returns true unless CUE_PICKER=classic env var; renderCombineFrame is only called within the classic runPickerClassic code path (picker.ts:1012-1185).
- risk: Removing kills the CUE_PICKER=classic escape hatch. Treat as a gated deletion that also removes runPickerClassic.

### src/lib/picker.ts:176 — `buildCompanionOptions`
- kind: dead-branch
- confidence: **high**
- est. lines: 207
- evidence: grep -r 'buildCompanionOptions|BuildCompanionArgs' src/lib --include='*.ts' | grep -v picker.ts → only picker.test.ts. Called solely within classic runPickerClassic; pickerV2Enabled() is true by default.
- risk: Classic picker only; safe to delete alongside the rest of the classic path.

### src/lib/picker.ts:829 — `FilterSelectPrompt`
- kind: dead-branch
- confidence: **high**
- est. lines: 177
- evidence: grep -r 'FilterSelectPrompt' src --include='*.ts' | grep -v picker.ts → no results. Class instantiated only within classic runPickerClassic; v2 uses StackPalettePrompt in src/lib/picker/palette.ts.
- risk: Classic picker only.

### src/lib/picker.ts:1012 — `runPickerClassic`
- kind: dead-branch
- confidence: **high**
- est. lines: 174
- evidence: picker.ts:1006-1011 — runPicker() calls runPickerClassic only when pickerV2Enabled() returns false, which requires CUE_PICKER=classic|v1|legacy (flow.ts:36-38). No other caller. grep -r 'runPickerClassic' src --include='*.ts' | grep -v picker.ts → empty.
- risk: Deleting removes the CUE_PICKER=classic escape hatch; coordinate with any documented rollback path.

### src/lib/picker.ts:671 — `applyShowAllExpansion`
- kind: dead-branch
- confidence: **high**
- est. lines: 133
- evidence: grep -r 'applyShowAllExpansion' src/lib --include='*.ts' | grep -v picker.ts → only picker.test.ts. Called only within classic FilterSelectPrompt._keypress (picker.ts lines 900-950 area).
- risk: Classic picker only.

### src/lib/picker.ts:94 — `groupByCategory`
- kind: dead-branch
- confidence: **high**
- est. lines: 58
- evidence: grep -r 'AsciiMSOption|groupByCategory' src/lib --include='*.ts' | grep -v picker.ts → only picker.test.ts. AsciiMSOption type and groupByCategory() are both only used within classic buildCompanionOptions (picker.ts:176-382).
- risk: Classic picker only.

### bin/cue-slug — `cue-slug`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 55
- evidence: grep -r 'cue-slug' /home/deadpool/Documents/cue --include='*.ts' --include='*.json' --include='*.md' --include='*.sh' --include='*.yaml' --include='*.yml' | grep -v node_modules | grep -v .claude/worktrees → no output. Not listed in package.json bin surface (only cue=bin/cue.mjs is declared). wc -l bin/cue-slug = 55.
- risk: Low; may be intended for manual ad-hoc use. Verify with author before deleting.

### bin/README.md — `bin/README.md`
- kind: unreferenced-file
- confidence: **high**
- est. lines: 32
- evidence: cat bin/README.md → describes 'soul use <name>', 'soul list', 'bin/cli/index.ts', 'soul init-shell' — none of these paths or commands exist; the repo is now called cue. wc -l = 32. No code file imports or references this document.
- risk: Documentation only; misleads contributors. Safe to delete or rewrite.

### src/lib/picker.ts:804 — `filterOptions`
- kind: dead-branch
- confidence: **high**
- est. lines: 25
- evidence: grep -r 'filterOptions' src/lib --include='*.ts' | grep -v picker.ts → only picker.test.ts. Called only within classic FilterSelectPrompt._keypress.
- risk: Classic picker only.

### src/lib/picker.ts:152 — `FEATURED_HINT`
- kind: dead-branch
- confidence: **high**
- est. lines: 24
- evidence: grep -r 'FEATURED_HINT|FREQUENT_HINT|UNIVERSAL_HINT|HISTORY_HINT|MAX_FREQUENT_AUTOCHECK|COMBINE_AUTO_CHECK_CONFIDENCE' src --include='*.ts' | grep -v picker.ts → only picker.test.ts and companion-detect.test.ts (test-only). All constants are consumed exclusively by classic buildCompanionOptions.
- risk: COMBINE_AUTO_CHECK_CONFIDENCE is imported in companion-detect.test.ts; that test covers classic behavior only.

### src/lib/picker/tally.ts:78 — `formatCombinedPreview`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 22
- evidence: grep -r 'formatCombinedPreview' src --include='*.ts' | grep -v picker → no results. Export only appears in classic picker.ts (buildCompanionOptions) and tally.test.ts; v2 uses formatOverheadBadge and formatStackTotals instead.
- risk: Classic picker helper; safe to remove alongside the classic path.

### scripts/_test-ecc-materialize.ts — `scripts/_test-ecc-materialize.ts`
- kind: unreferenced-file
- confidence: **high**
- est. lines: 20
- evidence: grep -r '_test-ecc-materialize|test-ecc' /home/deadpool/Documents/cue --include='*.ts' --include='*.json' --include='*.sh' --include='*.md' | grep -v node_modules | grep -v .claude/worktrees → no output. Not referenced in package.json scripts. Underscore prefix signals dev scratch file. wc -l = 20.
- risk: None; developer scratch file.

### src/lib/picker.ts:75 — `renderProfileList`
- kind: orphaned-helper
- confidence: **high**
- est. lines: 19
- evidence: grep -r 'renderProfileList' src --include='*.ts' | grep -v picker.ts → only picker.test.ts. No production caller in commands/ or any other lib/ file. Not re-exported via src/lib/picker.ts barrel.
- risk: Low; test coverage exists but there is no live code path to this function.

### src/lib/tui/input.ts:24 — `decodeKey`
- kind: unreachable-code
- confidence: **high**
- est. lines: 15
- evidence: grep -n '"end"|"slash"|"left"|"right"|"enter"' src/lib/tui/app.ts → no matches. handleKey() in app.ts handles 10 of 15 event types (q/ctrl-c/esc/tab/up/down/page-up/page-down/home/char). decodeKey emits 5 additional types at input.ts:10-13,17,21,32,41-44,53 (enter/left/right/end/slash) that silently fall through the app loop without effect.
- risk: Removing these decode branches would break any future handler that wants enter/arrow navigation in the TUI.

### src/lib/picker/selector.ts:12 — `compressCombo`
- kind: dead-branch
- confidence: **high**
- est. lines: 12
- evidence: grep -r 'compressCombo|SKIP_COMBINE|SHOW_ALL' src --include='*.ts' | grep -v picker → no results. SKIP_COMBINE (line 12) and SHOW_ALL (line 19) are string sentinels only referenced in classic picker.ts; compressCombo (line 48) is called only within classic buildCompanionOptions and covered by picker.test.ts.
- risk: Classic picker only; all three can be removed with the classic path.

### src/lib/tui/markdown.ts:31 — `visibleWidth`
- kind: unreferenced-export
- confidence: **high**
- est. lines: 9
- evidence: grep -r 'visibleWidth' src --include='*.ts' | grep -v markdown → only markdown.test.ts. The function is called internally by ansiAwareTruncate (markdown.ts) but the public export has zero consumers outside the file. No re-export via any barrel.
- risk: None if inlined or unexported; the implementation stays live through ansiAwareTruncate.

_notes:_ The dominant pattern is the classic (v1) picker dead-branch: pickerV2Enabled() in src/lib/picker/flow.ts:36-38 returns true by default; the entire classic code path (~880 lines across picker.ts and selector.ts/tally.ts helpers) only runs under CUE_PICKER=classic|v1|legacy. All commands in src/commands/_index.ts are lazy-loaded via string names and confirmed live. package.json bin declares only "cue"=bin/cue.mjs; cue-slug is absent. Dynamic import paths in _index.ts were cross-checked: all map to real command files.

