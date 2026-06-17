import React from 'react';
import { LiveDot } from 'cue-studio';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg1)', padding: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
    {children}
  </div>
);

export const Default = () => (
  <Wrap>
    <LiveDot />
    <span style={{ fontFamily: 'var(--ui)', fontSize: '13px', color: 'var(--fg2)' }}>Live agent session</span>
  </Wrap>
);

export const Multiple = () => (
  <Wrap>
    <LiveDot />
    <LiveDot />
    <LiveDot />
  </Wrap>
);
