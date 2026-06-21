import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createIpRateLimit } from '@/admin/server/middleware/rateLimit.js';

function makeApp() {
  const app = new Hono();
  app.use('/x', createIpRateLimit({ capacity: 2, refillPerSec: 1 }));
  app.get('/x', (c) => c.text('ok'));
  return app;
}

function get(app: Hono, xff: string) {
  return app.request('/x', { headers: { 'x-forwarded-for': xff } });
}

describe('createIpRateLimit', () => {
  it('passes requests under the limit and 429s over it', async () => {
    const app = makeApp();

    expect((await get(app, '9.9.9.9')).status).toBe(200);
    expect((await get(app, '9.9.9.9')).status).toBe(200);
    expect((await get(app, '9.9.9.9')).status).toBe(429);
  });

  it('isolates limits per client IP', async () => {
    const app = makeApp();

    await get(app, '1.1.1.1');
    await get(app, '1.1.1.1'); // 1.1.1.1 now exhausted
    expect((await get(app, '1.1.1.1')).status).toBe(429);
    // A different IP is unaffected.
    expect((await get(app, '2.2.2.2')).status).toBe(200);
  });

  it('keys on the proxy-set (right-most) IP, resisting XFF spoofing', async () => {
    const app = makeApp();

    // Same real client (right-most = 9.9.9.9) with a varying spoofed left-most entry.
    // All three must count against the SAME bucket, so the 3rd is throttled.
    expect((await get(app, 'aaa, 9.9.9.9')).status).toBe(200);
    expect((await get(app, 'bbb, 9.9.9.9')).status).toBe(200);
    expect((await get(app, 'ccc, 9.9.9.9')).status).toBe(429);
  });

  it('supports a custom onLimit response (redirect)', async () => {
    const app = new Hono();
    app.use(
      '/x',
      createIpRateLimit({
        capacity: 1,
        refillPerSec: 1,
        onLimit: (c) => c.redirect('/login?error=ratelimit'),
      }),
    );
    app.get('/x', (c) => c.text('ok'));

    expect((await get(app, '9.9.9.9')).status).toBe(200);
    const limited = await get(app, '9.9.9.9');
    expect(limited.status).toBe(302);
    expect(limited.headers.get('location')).toBe('/login?error=ratelimit');
  });
});
