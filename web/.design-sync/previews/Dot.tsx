import React from 'react';
import { Dot } from 'cue-studio';

const Wrap = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg1)', padding: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
    {children}
  </div>
);

export const AllVariants = () => (
  <Wrap>
    <Dot variant="ok" />
    <Dot variant="violet" />
    <Dot variant="warn" />
    <Dot variant="red" />
  </Wrap>
);

export const Ok = () => <Wrap><Dot variant="ok" /></Wrap>;
export const Warn = () => <Wrap><Dot variant="warn" /></Wrap>;
export const Red = () => <Wrap><Dot variant="red" /></Wrap>;
