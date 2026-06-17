import React from 'react';
import { MonoTag } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg2)', padding: '24px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Dark>
    <MonoTag>~/Documents/cue</MonoTag>
    <MonoTag variant="dim">pid 48213</MonoTag>
    <MonoTag variant="green">v2.1.0</MonoTag>
  </Dark>
);

export const Variants = () => (
  <Dark>
    <MonoTag variant="default">cyan</MonoTag>
    <MonoTag variant="dim">dim</MonoTag>
    <MonoTag variant="green">green</MonoTag>
    <MonoTag variant="amber">amber</MonoTag>
    <MonoTag variant="red">red</MonoTag>
  </Dark>
);
