import type { ExperimentConfig } from '@vercel/agent-eval';
import { withProfile } from '../lib/with-profile.js';

// Treatment C: the improver profile (goal-with-a-check loop). Compare its pass
// rate on the same task against core (baseline) and gstack.
const config: ExperimentConfig = {
  agent: 'claude-code',
  runs: 3,
  earlyExit: false,
  sandbox: 'docker',
  scripts: ['build'],
  timeout: 600,
  ...withProfile('improver'),
};

export default config;
