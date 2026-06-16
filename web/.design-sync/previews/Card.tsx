import React from 'react';
import { Card, GhostButton, StatTile, MonoTag } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg0)', padding: '24px', maxWidth: '520px' }}>{children}</div>
);

export const Default = () => (
  <Dark>
    <Card
      title="medusa-storefront"
      subtitle="Vite + TanStack — port 8000"
      dot="ok"
      actions={<GhostButton>restart</GhostButton>}
    >
      <div style={{ display: 'flex', gap: '20px', padding: '8px 0' }}>
        <StatTile value="42ms" label="latency" variant="green" />
        <StatTile value={128} label="requests" />
      </div>
    </Card>
  </Dark>
);

export const Live = () => (
  <Dark>
    <Card title="agent session" subtitle="claude-opus-4-8 · running" dot="live">
      <div style={{ padding: '8px 0', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <MonoTag variant="dim">pid 48213</MonoTag>
        <MonoTag variant="green">+247 tok/s</MonoTag>
      </div>
    </Card>
  </Dark>
);

export const Plain = () => (
  <Dark>
    <Card>
      <div style={{ fontFamily: 'var(--ui)', fontSize: '13px', color: 'var(--fg)' }}>
        A bare card with no header — just a container with the studio border and background.
      </div>
    </Card>
  </Dark>
);
