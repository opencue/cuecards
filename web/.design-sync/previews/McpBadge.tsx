import React from 'react';
import { McpBadge } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg2)', padding: '24px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Dark>
    <McpBadge label="installed" variant="ok" />
    <McpBadge label="database" />
    <McpBadge label="postgres" />
    <McpBadge label="12 tools" />
  </Dark>
);

export const Variants = () => (
  <Dark>
    <McpBadge label="ok" variant="ok" />
    <McpBadge label="default" />
  </Dark>
);
