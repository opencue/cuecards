import React from 'react';
import { EmptyState, Card } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg0)', padding: '24px', maxWidth: '480px' }}>{children}</div>
);

export const Default = () => (
  <Dark>
    <Card title="Sessions" dot="warn">
      <EmptyState
        message="No active sessions yet."
        command="cue start core"
      />
    </Card>
  </Dark>
);

export const MessageOnly = () => (
  <Dark>
    <Card title="Logs">
      <EmptyState message="Nothing logged in the last hour." />
    </Card>
  </Dark>
);
