import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/generated/prisma/client', () => ({ Prisma: { PrismaClientKnownRequestError: class extends Error {} } }));
vi.mock('@/lib/meta/client', () => ({ MetaApiError: class extends Error { code = 0; } }));
vi.mock('@/lib/workspace-access', () => ({
  canManageWorkspace: () => true,
  getCurrentWorkspaceContext: async () => ({ workspaceId: 'ws', role: 'OWNER' }),
}));

import { isTrustedOrigin, withZernioManagement } from '@/lib/zernio/route-handler';

const ORIGINAL_URL = process.env.NEXTAUTH_URL;
afterEach(() => { process.env.NEXTAUTH_URL = ORIGINAL_URL; });

function post(url: string, headers: Record<string, string>) {
  return new Request(url, { method: 'POST', headers });
}

describe('isTrustedOrigin', () => {
  it('accepts an Origin equal to the request URL origin', () => {
    const request = post('https://open.example/api/zernio/settings', { origin: 'https://open.example' });
    expect(isTrustedOrigin(request, 'https://open.example')).toBe(true);
  });

  it('accepts the configured public URL when the proxy rewrote the request to http', () => {
    process.env.NEXTAUTH_URL = 'https://open.example';
    const request = post('http://open.example/api/zernio/settings', { origin: 'https://open.example' });
    expect(isTrustedOrigin(request, 'https://open.example')).toBe(true);
  });

  it('accepts the origin described by x-forwarded-proto and x-forwarded-host', () => {
    delete process.env.NEXTAUTH_URL;
    const request = post('http://0.0.0.0:3000/api/zernio/settings', {
      origin: 'https://open.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'open.example',
    });
    expect(isTrustedOrigin(request, 'https://open.example')).toBe(true);
  });

  it('still rejects a foreign origin', () => {
    process.env.NEXTAUTH_URL = 'https://open.example';
    const request = post('http://open.example/api/zernio/settings', {
      origin: 'https://evil.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'open.example',
    });
    expect(isTrustedOrigin(request, 'https://evil.example')).toBe(false);
  });
});

describe('withZernioManagement origin check', () => {
  it('lets a proxied save through and blocks a cross-site one', async () => {
    process.env.NEXTAUTH_URL = 'https://open.example';
    const handler = withZernioManagement(async () => new Response('ok'));

    const proxied = await handler(post('http://open.example/api/zernio/settings', { origin: 'https://open.example' }));
    expect(proxied.status).toBe(200);

    const foreign = await handler(post('http://open.example/api/zernio/settings', { origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    await expect(foreign.json()).resolves.toMatchObject({ error: 'Invalid request origin.' });
  });
});
