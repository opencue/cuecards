import React from 'react';
import { PageHeader, GhostButton, SegmentedControl } from 'cue-studio';

const Dark = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg0)', padding: '24px' }}>{children}</div>
);

export const Default = () => (
  <Dark>
    <PageHeader
      title="Sessions"
      subtitle="Live agent runs across all profiles"
      dot="live"
      actions={<GhostButton>new session</GhostButton>}
    />
  </Dark>
);

export const WithFilters = () => (
  <Dark>
    <PageHeader
      title="Marketplace"
      subtitle="58 skills · 13 MCP servers"
      dot="ok"
      actions={
        <SegmentedControl
          options={[
            { label: 'All', value: 'all' },
            { label: 'Skills', value: 'skills' },
            { label: 'MCPs', value: 'mcps' },
          ]}
          value="all"
        />
      }
    />
  </Dark>
);

export const TitleOnly = () => (
  <Dark>
    <PageHeader title="Settings" />
  </Dark>
);
