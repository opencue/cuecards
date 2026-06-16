import React from 'react';
import { Pill } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg2)', padding: '24px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Dark>
    <Pill label="core" />
    <Pill label="commerce" />
    <Pill label="postgres" />
  </Dark>
);

export const WithCount = () => (
  <Dark>
    <Pill label="skills" count={58} />
    <Pill label="mcps" count={13} />
    <Pill label="profiles" count={7} />
  </Dark>
);
