// @vitest-environment node
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/MaintenanceGuard', () => ({ MaintenanceGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('test-only website labelling', () => {
  it('shows a visible warning and noindex metadata only in test mode', async () => {
    vi.stubEnv('PRINTLY_ISOLATED_TEST', '1');
    const { default: Layout, metadata } = await import('./layout');
    const html = renderToStaticMarkup(<Layout><p>Page</p></Layout>);
    expect(html).toContain('ISOLATED TEST SITE');
    expect(html).toContain('Do not use real shop accounts, files or payments');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('does not add the test warning to the ordinary site', async () => {
    vi.stubEnv('PRINTLY_ISOLATED_TEST', '');
    const { default: Layout, metadata } = await import('./layout');
    expect(renderToStaticMarkup(<Layout><p>Page</p></Layout>)).not.toContain('ISOLATED TEST SITE');
    expect(metadata.robots).toBeUndefined();
  });
});
