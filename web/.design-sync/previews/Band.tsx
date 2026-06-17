import React from 'react';
import { Band, StatTile, Pill, Dot } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg0)', padding: '24px' }}>{children}</div>
);

export const Default = () => (
  <Dark>
    <Band heading="Active Sessions" tag="3" tagVariant="ok">
      <div style={{ display: 'flex', gap: '16px', padding: '12px 0' }}>
        <StatTile value={3} label="running" variant="green" />
        <StatTile value={1} label="waiting" variant="amber" />
        <StatTile value={12} label="today" />
      </div>
    </Band>
  </Dark>
);

export const WithChildren = () => (
  <Dark>
    <Band heading="Profiles" tag="active">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Dot variant="ok" />
          <span style={{ fontFamily: 'var(--ui)', fontSize: '13px', color: 'var(--fg)' }}>core</span>
          <Pill label="base" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Dot variant="violet" />
          <span style={{ fontFamily: 'var(--ui)', fontSize: '13px', color: 'var(--fg)' }}>commerce</span>
          <Pill label="full" count={12} />
        </div>
      </div>
    </Band>
  </Dark>
);

export const Empty = () => (
  <Dark>
    <Band heading="Recent Logs" />
  </Dark>
);
