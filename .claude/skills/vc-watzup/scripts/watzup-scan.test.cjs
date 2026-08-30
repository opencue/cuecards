'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildPayload, parseArgs, readPlan, renderText } = require('./watzup-scan.cjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stderr}`);
  return (result.stdout || '').trim();
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function commitAll(repo, message) {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
}

function createFixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watzup-scan-'));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(repo);
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['checkout', '-b', 'main']);
  writeFile(path.join(repo, 'README.md'), '# fixture\n');
  commitAll(repo, 'initial commit');

  git(root, ['init', '--bare', remote]);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'main']);

  git(repo, ['checkout', '-b', 'feature/local']);
  writeFile(path.join(repo, 'process', 'general-plans', 'active', 'fixture_PLAN_27-05-26.md'), [
    '# Fixture Feature',
    '',
    '**Status**: PLANNED',
    '',
    'SECRET_BODY_SHOULD_NOT_APPEAR',
    '',
    '| Phase | Name | Status |',
    '|-------|------|--------|',
    '| 1 | Build | Pending |',
  ].join('\n'));
  writeFile(path.join(repo, 'process', 'general-plans', 'active', 'phase-01-build.md'), [
    '# Build Phase',
    '',
    '**Status**: ACTIVE',
  ].join('\n'));
  commitAll(repo, 'feat: add unfinished flowser plan');

  git(repo, ['checkout', '-b', 'remote-work', 'main']);
  writeFile(path.join(repo, 'process', 'features', 'demo', 'active', 'PLAN.md'), [
    '---',
    'title: "Remote Demo"',
    'status: in progress',
    '---',
    '',
    '# Remote Demo',
  ].join('\n'));
  commitAll(repo, 'feat: remote branch work');
  git(repo, ['push', 'origin', 'remote-work']);
  git(repo, ['checkout', 'feature/local']);
  git(repo, ['fetch', 'origin', 'remote-work']);

  const worktreePath = path.join(root, 'worktree');
  git(repo, ['worktree', 'add', '-b', 'worktree-branch', worktreePath, 'main']);
  writeFile(path.join(worktreePath, 'process', 'features', 'demo', 'active', 'phase-02-followup.md'), [
    '# Follow-up',
    '',
    '**Status**: BLOCKED',
  ].join('\n'));
  commitAll(worktreePath, 'feat: worktree branch plan');

  return { root, repo, worktreePath };
}

test('parseArgs keeps fetch opt-in and supports parity flags', () => {
  const parsed = parseArgs(['--json', '--max-branches', '5', '--commits-per-branch', '2', '--plan-limit', '4', '--max-plan-refs', '6']);

  assert.equal(parsed.fetch, false);
  assert.equal(parsed.maxBranches, 5);
  assert.equal(parsed.commitsPerBranch, 2);
  assert.equal(parsed.planLimit, 4);
  assert.equal(parsed.maxPlanRefs, 6);
});

test('parseArgs rejects missing and invalid values', () => {
  assert.throws(() => parseArgs(['--since']), /--since requires a value/);
  assert.throws(() => parseArgs(['--selected-plan']), /--selected-plan requires a value/);
  assert.throws(() => parseArgs(['--max-branches', 'nope']), /positive integer/);
});

test('readPlan marks pending phase tables as unfinished for Flowser plans', () => {
  const plan = readPlan([
    '# Pending Plan',
    '',
    '**Status**: COMPLETED',
    '',
    '| Phase | Name | Status |',
    '|-------|------|--------|',
    '| 1 | Build | Pending |',
  ].join('\n'), 'process/general-plans/active/test_PLAN_27-05-26.md', { type: 'test' });

  assert.equal(plan.kind, 'primary');
  assert.equal(plan.unfinished, true);
});

test('buildPayload scans remote refs, worktrees, and Flowser process plans without fetch by default', () => {
  const fixture = createFixtureRepo();
  try {
    const payload = buildPayload({
      fetch: false,
      maxBranches: 20,
      commitsPerBranch: 2,
      planLimit: 10,
      maxPlanRefs: 20,
    }, fixture.repo);

    assert.equal(payload.options.fetchRequested, false);
    assert.equal(payload.options.fetched, false);
    assert.ok(payload.refs.remote >= 2, 'remote refs should be included');
    assert.ok(payload.branches.some((branch) => branch.name === 'origin/remote-work'));
    const expectedWorktree = fs.realpathSync.native(fixture.worktreePath);
    assert.ok(payload.worktrees.some((worktree) => fs.realpathSync.native(worktree.path) === expectedWorktree));
    assert.ok(payload.plans.unfinished.some((plan) => plan.path === 'process/general-plans/active/fixture_PLAN_27-05-26.md'));
    assert.ok(payload.plans.unfinished.some((plan) => plan.path === 'process/features/demo/active/PLAN.md'));
    assert.ok(payload.warnings.some((warning) => warning.includes('Remote branches reflect local refs only')));
    assert.equal(JSON.stringify(payload).includes('SECRET_BODY_SHOULD_NOT_APPEAR'), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('selected-plan hint is advisory for single primary and explicit for CLI override', () => {
  const fixture = createFixtureRepo();
  try {
    const implicit = buildPayload({ fetch: false }, fixture.repo);
    assert.equal(implicit.selectedPlanHint.path, 'process/general-plans/active/fixture_PLAN_27-05-26.md');
    assert.equal(implicit.selectedPlanHint.advisory, true);

    const explicit = buildPayload({
      fetch: false,
      selectedPlan: path.join(fixture.repo, 'process', 'general-plans', 'active', 'fixture_PLAN_27-05-26.md'),
    }, fixture.repo);
    assert.equal(explicit.selectedPlanHint.source, 'explicit');
    assert.equal(explicit.selectedPlanHint.advisory, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('multiple primary local plans suppress inferred selected-plan hints', () => {
  const fixture = createFixtureRepo();
  try {
    writeFile(path.join(fixture.repo, 'process', 'features', 'demo', 'active', 'demo_PLAN_27-05-26.md'), [
      '# Demo Primary',
      '',
      '**Status**: ACTIVE',
    ].join('\n'));
    commitAll(fixture.repo, 'feat: add second primary plan');

    const payload = buildPayload({ fetch: false }, fixture.repo);
    assert.equal(payload.selectedPlanHint, null);
    assert.ok(payload.warnings.some((warning) => warning.includes('Multiple primary active plans exist locally')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('tracked plan scan is bounded separately from branch discovery', () => {
  const fixture = createFixtureRepo();
  try {
    const payload = buildPayload({
      fetch: false,
      maxBranches: 20,
      commitsPerBranch: 1,
      planLimit: 10,
      maxPlanRefs: 1,
    }, fixture.repo);

    assert.ok(payload.refs.total > 1);
    assert.ok(payload.warnings.some((warning) => warning.includes('Tracked plan scan limited to 1 ranked refs')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('failed fetch reports the failure and keeps output usable', () => {
  const fixture = createFixtureRepo();
  try {
    git(fixture.repo, ['remote', 'set-url', 'origin', path.join(fixture.root, 'missing.git')]);
    const payload = buildPayload({ fetch: true, maxPlanRefs: 20 }, fixture.repo);

    assert.equal(payload.options.fetchRequested, true);
    assert.equal(payload.options.fetched, false);
    assert.ok(payload.warnings.some((warning) => warning.includes('fetch failed')));
    assert.ok(payload.warnings.some((warning) => warning.includes('Fetch failed; remote-branch evidence may be stale')));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('detached HEAD still produces a useful text report', () => {
  const fixture = createFixtureRepo();
  try {
    git(fixture.repo, ['checkout', '--detach', 'HEAD']);
    const payload = buildPayload({ fetch: false }, fixture.repo);
    const text = renderText(payload);

    assert.equal(payload.current.detached, true);
    assert.match(text, /Current State/);
    assert.match(text, /detached@/);
    assert.match(text, /In-Flight Plans/);
    assert.match(text, /Warnings/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
