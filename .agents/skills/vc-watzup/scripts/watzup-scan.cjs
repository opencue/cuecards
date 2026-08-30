#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readSessionState } = require('../../../hooks/lib/vc-config-utils.cjs');

const DEFAULTS = {
  maxBranches: 12,
  commitsPerBranch: 3,
  planLimit: 8,
  maxPlanRefs: 80,
};

const PRIMARY_PLAN_PATTERNS = [/^[^/]+_PLAN_\d{2}-\d{2}-\d{2}\.md$/i, /^PLAN\.md$/i, /^plan\.md$/i];
const PHASE_PLAN_PATTERN = /^phase-.*\.md$/i;

function parsePositiveInt(value, name, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} requires a value`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(`${name} must be a positive integer between 1 and 500`);
  }

  return parsed;
}

function parseRequiredValue(argv, index, name) {
  const value = argv[index + 1];
  if (value === undefined || value === null || value === '' || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    json: false,
    fetch: false,
    since: null,
    cwd: process.cwd(),
    selectedPlan: null,
    ...DEFAULTS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--fetch') options.fetch = true;
    else if (arg === '--since') {
      options.since = parseRequiredValue(argv, index, '--since');
      index += 1;
    }
    else if (arg === '--cwd') {
      options.cwd = path.resolve(parseRequiredValue(argv, index, '--cwd'));
      index += 1;
    }
    else if (arg === '--selected-plan') {
      options.selectedPlan = parseRequiredValue(argv, index, '--selected-plan');
      index += 1;
    }
    else if (arg === '--max-branches') options.maxBranches = parsePositiveInt(argv[++index], '--max-branches');
    else if (arg === '--commits-per-branch') options.commitsPerBranch = parsePositiveInt(argv[++index], '--commits-per-branch');
    else if (arg === '--plan-limit') options.planLimit = parsePositiveInt(argv[++index], '--plan-limit');
    else if (arg === '--max-plan-refs') options.maxPlanRefs = parsePositiveInt(argv[++index], '--max-plan-refs');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`watzup-scan

Usage:
  node .claude/skills/watzup/scripts/watzup-scan.cjs [--json] [--fetch]

Options:
  --json                   Emit machine-readable evidence
  --fetch                  Run git fetch --all --prune before scanning
  --cwd <path>             Scan a different checkout root
  --selected-plan <path>   Provide an explicit selected-plan hint
  --since <date>           Limit per-branch commit samples, e.g. "14 days ago"
  --max-branches <n>       Branches to summarize in handoff output
  --commits-per-branch <n> Commit subjects per summarized branch
  --plan-limit <n>         Unfinished plans to include in short output
  --max-plan-refs <n>      Ranked refs to inspect for tracked Flowser plan files`);
}

function runGit(args, cwd, { ok = [0] } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (!ok.includes(result.status)) {
    const message = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${message ? `: ${message}` : ''}`);
  }
  return (result.stdout || '').trimEnd();
}

function tryGit(args, cwd, { ok = [0] } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: ok.includes(result.status),
    stdout: (result.stdout || '').trimEnd(),
    stderr: (result.stderr || '').trimEnd(),
    status: result.status,
  };
}

function getGitRoot(cwd) {
  const result = tryGit(['rev-parse', '--show-toplevel'], cwd);
  return result.ok && result.stdout ? result.stdout : cwd;
}

function parseWorktrees(output) {
  const records = [];
  let current = null;

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');

    if (key === 'worktree') {
      current = { path: value, head: null, branch: null, detached: false, bare: false };
      records.push(current);
    } else if (current && key === 'HEAD') current.head = value;
    else if (current && key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (current && key === 'detached') current.detached = true;
    else if (current && key === 'bare') current.bare = true;
  }

  return records;
}

function getWorktrees(root, warnings) {
  const result = tryGit(['worktree', 'list', '--porcelain'], root);
  if (!result.ok) {
    warnings.push(`Could not read worktree list: ${result.stderr || result.stdout || 'unknown git error'}`);
    return [];
  }
  return parseWorktrees(result.stdout);
}

function getRefs(root, warnings) {
  const format = ['%(refname)', '%(refname:short)', '%(objectname:short)', '%(committerdate:iso8601)', '%(subject)'].join('\t');
  const result = tryGit(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], root);
  if (!result.ok) {
    warnings.push(`Could not read branch refs: ${result.stderr || result.stdout || 'unknown git error'}`);
    return [];
  }

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [refname, shortName, commit, date, ...subjectParts] = line.split('\t');
      const isRemote = refname.startsWith('refs/remotes/');
      return {
        refname,
        name: shortName,
        commit,
        date,
        subject: subjectParts.join('\t'),
        type: isRemote ? 'remote' : 'local',
      };
    })
    .filter((ref) => !ref.refname.endsWith('/HEAD'));
}

function getCurrentState(root, worktrees, warnings) {
  const branchResult = tryGit(['branch', '--show-current'], root);
  if (!branchResult.ok) warnings.push(`Could not determine current branch: ${branchResult.stderr || branchResult.stdout || 'unknown git error'}`);

  const headResult = tryGit(['rev-parse', '--short', 'HEAD'], root);
  if (!headResult.ok) warnings.push(`Could not determine HEAD commit: ${headResult.stderr || headResult.stdout || 'unknown git error'}`);

  const statusResult = tryGit(['status', '--short', '--branch'], root);
  if (!statusResult.ok) warnings.push(`Could not read git status: ${statusResult.stderr || statusResult.stdout || 'unknown git error'}`);

  const branch = branchResult.ok && branchResult.stdout ? branchResult.stdout : null;
  const lines = statusResult.ok && statusResult.stdout ? statusResult.stdout.split('\n').filter(Boolean) : [];
  const summaryLine = lines[0] || '';
  const fileLines = lines.slice(summaryLine ? 1 : 0);
  const aheadMatch = summaryLine.match(/ahead (\d+)/);
  const behindMatch = summaryLine.match(/behind (\d+)/);
  const currentWorktree = worktrees.find((record) => path.resolve(record.path) === path.resolve(root)) || null;

  return {
    root,
    branch,
    head: headResult.ok ? headResult.stdout : null,
    detached: !branch,
    dirty: fileLines.length > 0,
    dirtyCount: fileLines.length,
    statusLine: summaryLine || null,
    statusLines: fileLines.slice(0, 20),
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    worktree: currentWorktree,
  };
}

function rankRefs(refs, state, worktrees) {
  const checkedOut = new Set(worktrees.map((record) => record.branch).filter(Boolean));
  return refs
    .map((ref) => {
      let rank = 0;
      if (state.branch && ref.name === state.branch) rank += 1000;
      if (checkedOut.has(ref.name)) rank += 500;
      if (ref.type === 'local') rank += 100;
      const time = Date.parse(ref.date);
      return {
        ...ref,
        checkedOut: checkedOut.has(ref.name),
        rank,
        time: Number.isFinite(time) ? time : 0,
      };
    })
    .sort((a, b) => (b.rank - a.rank) || (b.time - a.time) || a.name.localeCompare(b.name));
}

function getBranchCommits(root, ref, options) {
  const args = ['log', ref.refname, `--max-count=${options.commitsPerBranch}`, '--pretty=format:%h%x09%s%x09%cr'];
  if (options.since) args.splice(2, 0, `--since=${options.since}`);
  const result = tryGit(args, root);
  if (!result.ok || !result.stdout) return [];

  return result.stdout.split('\n').map((line) => {
    const [shortHash, subject, relativeDate] = line.split('\t');
    return { shortHash, subject, relativeDate };
  });
}

function walkFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, result);
      continue;
    }
    if (entry.isFile()) result.push(fullPath);
  }

  return result;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};

  const data = {};
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[field[1]] = value;
  }

  return data;
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase().trim();
  if (['completed', 'complete', 'done', 'verified'].includes(status)) return 'completed';
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled';
  if (status.includes('blocked')) return 'blocked';
  if (status.includes('review')) return 'in-review';
  if (status.includes('testing')) return 'testing';
  if (status.includes('progress') || status === 'active' || status === 'planned') return 'in-progress';
  return status || 'pending';
}

function extractTitle(content, planPath) {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter.title) return frontmatter.title;
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return path.basename(planPath);
}

function parseTableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function cleanTableCell(cell) {
  return cell.replace(/[*_`]/g, '').trim();
}

function isSeparatorCell(cell) {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function isIncompleteStatusCell(cell) {
  return ['pending', 'in-progress', 'active', 'todo', 'planned', 'testing', 'blocked'].includes(normalizeStatus(cleanTableCell(cell)));
}

function hasIncompletePhase(content) {
  let statusColumn = null;

  for (const line of content.split('\n')) {
    if (!/^\s*\|/.test(line)) {
      statusColumn = null;
      continue;
    }

    const cells = parseTableCells(line);
    if (cells.every(isSeparatorCell)) continue;

    const headerStatusColumn = cells.findIndex((cell) => cleanTableCell(cell).toLowerCase() === 'status');
    if (headerStatusColumn !== -1) {
      statusColumn = headerStatusColumn;
      continue;
    }

    const candidates = statusColumn === null ? cells : [cells[statusColumn]];
    if (candidates.some((cell) => cell && isIncompleteStatusCell(cell))) return true;
  }

  return false;
}

function planKindFromPath(planPath) {
  const base = path.basename(planPath);
  if (PRIMARY_PLAN_PATTERNS.some((pattern) => pattern.test(base))) return 'primary';
  if (PHASE_PLAN_PATTERN.test(base)) return 'phase';
  return 'supporting';
}

function extractFeature(planPath) {
  const normalized = planPath.split(path.sep).join('/');
  const match = normalized.match(/^process\/features\/([^/]+)\//);
  return match ? match[1] : null;
}

function readPlan(content, planPath, source) {
  const frontmatter = parseFrontmatter(content);
  const inlineStatus = content.match(/\*\*Status\*\*:\s*(.+)/i);
  const status = normalizeStatus(frontmatter.Status || frontmatter.status || (inlineStatus ? inlineStatus[1] : ''));
  const incompletePhase = hasIncompletePhase(content);
  const unfinished = !['completed', 'cancelled'].includes(status) || incompletePhase;

  return {
    id: `${source.ref || source.worktree || 'filesystem'}:${planPath}`,
    title: extractTitle(content, planPath),
    path: planPath.split(path.sep).join('/'),
    status,
    kind: planKindFromPath(planPath),
    feature: extractFeature(planPath),
    unfinished,
    source,
    hash: crypto.createHash('sha1').update(content).digest('hex').slice(0, 12),
  };
}

function isFlowserActivePlanPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  if (!normalized.endsWith('.md')) return false;
  if (normalized.startsWith('process/general-plans/active/')) return true;
  return /^process\/features\/[^/]+\/active\//.test(normalized);
}

function discoverFeatureActiveRoots(root) {
  const featuresDir = path.join(root, 'process', 'features');
  if (!fs.existsSync(featuresDir)) return [];

  return fs.readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(featuresDir, entry.name, 'active'))
    .filter((dir) => fs.existsSync(dir));
}

function getFilesystemActivePlanFiles(root) {
  const generalActive = path.join(root, 'process', 'general-plans', 'active');
  const roots = [generalActive, ...discoverFeatureActiveRoots(root)].filter((dir) => fs.existsSync(dir));
  return roots.flatMap((dir) => walkFiles(dir)).filter((file) => isFlowserActivePlanPath(path.relative(root, file)));
}

function scanFilesystemPlans(worktrees, warnings) {
  const plans = [];

  for (const worktree of worktrees) {
    if (!worktree.path || !fs.existsSync(worktree.path)) continue;

    const files = getFilesystemActivePlanFiles(worktree.path);
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        plans.push(readPlan(content, path.relative(worktree.path, file), {
          type: 'filesystem',
          worktree: worktree.path,
          branch: worktree.branch || null,
        }));
      } catch (error) {
        warnings.push(`Could not read active plan ${file}: ${error.message}`);
      }
    }
  }

  return plans;
}

function scanTrackedPlans(root, refs, warnings) {
  const plans = [];

  for (const ref of refs) {
    const listed = tryGit(['ls-tree', '-r', '--name-only', ref.refname, '--', 'process/general-plans/active', 'process/features'], root);
    if (!listed.ok || !listed.stdout) continue;

    const planPaths = listed.stdout.split('\n').filter((file) => isFlowserActivePlanPath(file));
    for (const planPath of planPaths) {
      const shown = tryGit(['show', `${ref.refname}:${planPath}`], root);
      if (!shown.ok || !shown.stdout) {
        warnings.push(`Could not inspect tracked plan ${ref.name}:${planPath}`);
        continue;
      }

      plans.push(readPlan(shown.stdout, planPath, {
        type: 'git-ref',
        ref: ref.name,
        refType: ref.type,
      }));
    }
  }

  return plans;
}

function dedupePlans(plans) {
  const byKey = new Map();

  for (const plan of plans) {
    const key = `${plan.path}:${plan.hash}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...plan, sources: [plan.source] });
      continue;
    }

    byKey.get(key).sources.push(plan.source);
  }

  return [...byKey.values()];
}

function rankPlan(plan, current) {
  let score = 0;

  for (const source of plan.sources || [plan.source]) {
    if (source.worktree && path.resolve(source.worktree) === path.resolve(current.root)) score += 1000;
    if (current.branch && (source.branch === current.branch || source.ref === current.branch)) score += 500;
    if (source.type === 'filesystem') score += 100;
    if (source.refType === 'local') score += 50;
  }

  return score;
}

function sortPlans(plans, current) {
  return plans.sort((a, b) => (rankPlan(b, current) - rankPlan(a, current)) || a.path.localeCompare(b.path));
}

function normalizePlanArg(root, input) {
  if (!input) return null;
  const candidate = path.isAbsolute(input) ? input : path.resolve(root, input);
  if (!fs.existsSync(candidate)) return null;
  return path.relative(root, candidate).split(path.sep).join('/');
}

function getSessionPlanHint(root) {
  const sessionId = process.env.CK_SESSION_ID || '';
  if (!sessionId) return null;

  const state = readSessionState(sessionId);
  const hintedPath = typeof state?.activePlan === 'string'
    ? state.activePlan
    : typeof state?.selectedPlan === 'string'
      ? state.selectedPlan
      : '';

  return normalizePlanArg(root, hintedPath);
}

function resolveSelectedPlanHint(root, options, filesystemPlans) {
  const explicit = normalizePlanArg(root, options.selectedPlan);
  if (explicit) {
    return { path: explicit, source: 'explicit', advisory: false };
  }

  const sessionHint = getSessionPlanHint(root);
  if (sessionHint) {
    return { path: sessionHint, source: 'session-state', advisory: true };
  }

  const primaryPlans = filesystemPlans.filter((plan) => plan.kind === 'primary');
  if (primaryPlans.length === 1) {
    return { path: primaryPlans[0].path, source: 'single-primary-plan', advisory: true };
  }

  return null;
}

function buildWarnings(payload) {
  const warnings = [...payload.warnings];

  if (payload.current.detached) warnings.push('Repository is on a detached HEAD.');
  if (!payload.options.fetchRequested && payload.refs.remote > 0) {
    warnings.push('Remote branches reflect local refs only. Use --fetch to refresh before treating them as current.');
  }
  if (payload.plans.total === 0) {
    warnings.push('No active plan files were found under process/general-plans/active/ or process/features/*/active/.');
  }
  if (!payload.selectedPlanHint && payload.plans.localPrimaryCount > 1) {
    warnings.push('Multiple primary active plans exist locally; no selected-plan hint is being assumed.');
  }
  if (payload.selectedPlanHint?.advisory) {
    warnings.push(`Selected plan is advisory (${payload.selectedPlanHint.source}) and does not replace explicit execute approval.`);
  }
  if (payload.options.fetchRequested) {
    warnings.push('Remote refresh was explicitly requested; verify any changed ahead/behind state before acting.');
  }
  if (payload.options.fetchRequested && !payload.options.fetched) {
    warnings.push('Fetch failed; remote-branch evidence may be stale.');
  }
  if (payload.refs.total > payload.options.maxPlanRefs) {
    warnings.push(`Tracked plan scan limited to ${payload.options.maxPlanRefs} ranked refs out of ${payload.refs.total}.`);
  }

  return warnings;
}

function buildNextSteps(payload) {
  const steps = [];

  if (payload.current.dirty) steps.push('Review or commit current worktree changes before handoff.');
  if (payload.current.detached) steps.push('Create or switch to a named branch before shipping work from this checkout.');
  if (payload.selectedPlanHint) {
    steps.push(`If execution should continue, confirm the selected plan explicitly: ${payload.selectedPlanHint.path}.`);
  } else if (payload.plans.localPrimaryCount > 0) {
    steps.push('Choose one primary active plan explicitly before any execute-phase work.');
  }

  const blockedPlan = payload.plans.unfinished.find((plan) => plan.status === 'blocked');
  if (blockedPlan) steps.push(`Check blocker status for ${blockedPlan.path} before resuming work.`);

  const remoteBranch = payload.branches.find((branch) => branch.type === 'remote');
  if (remoteBranch) steps.push(`Review recent remote branch ${remoteBranch.name} before duplicating effort.`);

  if (steps.length === 0) steps.push('No urgent action inferred; use this summary as orientation only.');
  return steps.slice(0, 5);
}

function renderText(payload) {
  const currentLabel = payload.current.branch || `detached@${payload.current.head || 'unknown'}`;
  const lines = [
    'Current State',
    `- Repo: ${payload.repo.root}`,
    `- Branch: ${currentLabel}`,
    `- Dirty: ${payload.current.dirty ? `yes (${payload.current.dirtyCount} file${payload.current.dirtyCount === 1 ? '' : 's'})` : 'no'}`,
    `- Worktrees: ${payload.worktrees.length}`,
  ];

  if (payload.current.ahead || payload.current.behind) {
    lines.push(`- Ahead/behind: +${payload.current.ahead} / -${payload.current.behind}`);
  }
  if (payload.selectedPlanHint) {
    lines.push(`- Selected plan hint: ${payload.selectedPlanHint.path} (${payload.selectedPlanHint.source}${payload.selectedPlanHint.advisory ? ', advisory' : ''})`);
  } else {
    lines.push('- Selected plan hint: none');
  }

  lines.push('', 'Recent Work');
  if (payload.branches.length === 0) {
    lines.push('- none');
  } else {
    for (const branch of payload.branches.slice(0, 5)) {
      const marks = [branch.type];
      if (branch.checkedOut) marks.push('worktree');
      const commitText = branch.commits[0] ? `; latest ${branch.commits[0].shortHash} ${branch.commits[0].subject}` : '';
      lines.push(`- ${branch.name} [${marks.join(', ')}] ${branch.commit}${commitText}`);
    }
  }

  lines.push('', 'In-Flight Plans');
  if (payload.plans.unfinished.length === 0) {
    lines.push('- none found');
  } else {
    for (const plan of payload.plans.unfinished.slice(0, 5)) {
      const source = plan.sources?.[0]?.ref || plan.sources?.[0]?.branch || plan.sources?.[0]?.type;
      const tags = [plan.kind, plan.status];
      if (plan.feature) tags.push(`feature:${plan.feature}`);
      lines.push(`- ${plan.path} [${tags.join(', ')}] via ${source || 'unknown'}`);
    }
  }

  lines.push('', 'Next Steps');
  payload.nextSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));

  lines.push('', 'Warnings');
  if (payload.warnings.length === 0) {
    lines.push('- none');
  } else {
    payload.warnings.forEach((warning) => lines.push(`- ${warning}`));
  }

  return `${lines.join('\n')}\n`;
}

function buildPayload(rawOptions, cwd = process.cwd()) {
  const options = {
    json: false,
    fetch: false,
    since: null,
    cwd,
    selectedPlan: null,
    ...DEFAULTS,
    ...rawOptions,
  };

  const root = getGitRoot(options.cwd || cwd);
  const warnings = [];
  let fetched = false;

  if (options.fetch) {
    const fetchResult = tryGit(['fetch', '--all', '--prune'], root);
    fetched = fetchResult.ok;
    if (!fetchResult.ok) warnings.push(`fetch failed: ${fetchResult.stderr || fetchResult.stdout || 'unknown git error'}`);
  }

  const worktrees = getWorktrees(root, warnings);
  const current = getCurrentState(root, worktrees, warnings);
  const refs = rankRefs(getRefs(root, warnings), current, worktrees);
  const branches = refs.slice(0, options.maxBranches).map((ref) => ({
    name: ref.name,
    refname: ref.refname,
    type: ref.type,
    commit: ref.commit,
    date: ref.date,
    subject: ref.subject,
    checkedOut: ref.checkedOut,
    commits: getBranchCommits(root, ref, options),
  }));

  const filesystemPlans = sortPlans(dedupePlans(scanFilesystemPlans(worktrees, warnings)), current);
  const trackedPlanRefs = refs.slice(0, options.maxPlanRefs);
  const trackedPlans = sortPlans(dedupePlans(scanTrackedPlans(root, trackedPlanRefs, warnings)), current);
  const mergedPlans = sortPlans(dedupePlans([...filesystemPlans, ...trackedPlans]), current);
  const unfinished = mergedPlans.filter((plan) => plan.unfinished).slice(0, options.planLimit);
  const selectedPlanHint = resolveSelectedPlanHint(root, options, filesystemPlans);

  const payload = {
    generatedAt: new Date().toISOString(),
    options: {
      fetched,
      fetchRequested: options.fetch,
      maxBranches: options.maxBranches,
      commitsPerBranch: options.commitsPerBranch,
      planLimit: options.planLimit,
      maxPlanRefs: options.maxPlanRefs,
      since: options.since,
      cwd: options.cwd,
      selectedPlan: options.selectedPlan,
    },
    repo: { root },
    current,
    worktrees,
    refs: {
      total: refs.length,
      local: refs.filter((ref) => ref.type === 'local').length,
      remote: refs.filter((ref) => ref.type === 'remote').length,
    },
    branches,
    plans: {
      localPrimaryCount: filesystemPlans.filter((plan) => plan.kind === 'primary').length,
      filesystem: filesystemPlans,
      tracked: trackedPlans,
      unfinished,
      total: mergedPlans.length,
    },
    selectedPlanHint,
    warnings,
  };

  payload.warnings = buildWarnings(payload);
  payload.nextSteps = buildNextSteps(payload);
  return payload;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const payload = buildPayload(options, options.cwd);
    process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : renderText(payload));
  } catch (error) {
    console.error(`watzup-scan failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildPayload,
  parseArgs,
  parseFrontmatter,
  readPlan,
  renderText,
  resolveSelectedPlanHint,
};
