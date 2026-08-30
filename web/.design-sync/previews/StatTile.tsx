import React from 'react';
import { StatTile } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg1)', padding: '24px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Dark>
    <StatTile value={42} label="sessions" />
    <StatTile value={128} label="tools called" />
    <StatTile value="8.3s" label="avg response" />
  </Dark>
);

export const Variants = () => (
  <Dark>
    <StatTile value={3} label="running" variant="green" />
    <StatTile value={1} label="failed" variant="red" />
    <StatTile value={7} label="pending" variant="amber" />
    <StatTile value={99} label="total" variant="violet" />
  </Dark>
);

export const MediumSize = () => (
  <Dark>
    <StatTile value="v2.1" label="version" size="md" />
    <StatTile value="4 MB" label="bundle" size="md" />
    <StatTile value="58" label="skills" size="md" variant="violet" />
  </Dark>
);
