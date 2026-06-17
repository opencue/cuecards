import React from 'react';
import { GhostButton } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg1)', padding: '24px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Dark>
    <GhostButton>restart</GhostButton>
    <GhostButton>logs</GhostButton>
    <GhostButton>copy</GhostButton>
  </Dark>
);

export const States = () => (
  <Dark>
    <GhostButton active>active</GhostButton>
    <GhostButton>default</GhostButton>
    <GhostButton disabled>disabled</GhostButton>
    <GhostButton variant="danger">delete</GhostButton>
  </Dark>
);
