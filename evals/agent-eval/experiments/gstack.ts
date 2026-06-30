import type { ExperimentConfig } from '@vercel/agent-eval';
import { withProfile } from '../lib/with-profile.js';

// Treatment B: the full gstack 58-role profile. Compare its pass rate on the
// same task against core (baseline) and improver.
const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 3,
  earlyExit: false,
  sandbox: 'docker',
  scripts: ['build'],
  timeout: 600,
  ...withProfile('gstack'),
};

export default config;
