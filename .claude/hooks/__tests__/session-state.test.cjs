#!/usr/bin/env node
'use strict';

const { handleSessionStateEvent } = require('../session-state.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    return false;
  }
}

async function run() {
  const results = [];

  results.push(await runCase('skips cleanly when hook disabled', async () => {
    const result = await handleSessionStateEvent(
      { hook_event_name: 'PostToolUse', session_id: 'abc' },
      { enabled: false }
    );
    assert(result.action === 'skipped-disabled', 'expected disabled skip');
  }));

  results.push(await runCase('skips when session id missing', async () => {
    const result = await handleSessionStateEvent(
      { hook_event_name: 'PostToolUse' },
      { enabled: true }
    );
    assert(result.action === 'skipped-no-session', 'expected missing session skip');
  }));

  results.push(await runCase('refreshes snapshot on PostToolUse', async () => {
    let refreshed = 0;
    const result = await handleSessionStateEvent(
      { hook_event_name: 'PostToolUse', session_id: 'abc' },
      {
        enabled: true,
        refresh: async () => {
          refreshed += 1;
          return { success: true };
        },
        persist: () => ({ success: false })
      }
    );
    assert(refreshed === 1, 'expected one refresh');
    assert(result.refreshed === true, 'expected refreshed flag');
    assert(result.persisted === false, 'expected no persist');
  }));

  results.push(await runCase('persists and refreshes on Stop', async () => {
    let persisted = 0;
    let refreshed = 0;
    const result = await handleSessionStateEvent(
      { hook_event_name: 'Stop', session_id: 'abc', cwd: process.cwd() },
      {
        enabled: true,
        refresh: async () => {
          refreshed += 1;
          return { success: true };
        },
        persist: () => {
          persisted += 1;
          return { success: true };
        }
      }
    );
    assert(persisted === 1, 'expected one persist');
    assert(refreshed === 1, 'expected one refresh');
    assert(result.persisted === true, 'expected persisted flag');
    assert(result.refreshed === true, 'expected refreshed flag');
  }));

  if (results.every(Boolean)) return;
  process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
