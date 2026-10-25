import { afterAll, beforeAll, it, expect } from 'vitest';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import {
  Miniflare,
  Log,
  LogLevel,
  Response as MockResponse,
  convertV4MiniflareOptions,
} from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

let mf: Miniflare,
  nonce = '',
  challenge = '',
  mode = 'valid',
  tokenCalls = 0;
const origin = 'http://localhost:5174';
beforeAll(async () => {
  const key = await generateKeyPair('RS256'),
    rogue = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(key.publicKey)), kid: 'test-google', alg: 'RS256', use: 'sig' };
  const output = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: output.outputFiles[0].text,
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
      bindings: {
        APP_ORIGIN: origin,
        DEV_AUTH_ENABLED: 'false',
        MARKET_ENABLED: 'true',
        GOOGLE_CLIENT_ID: 'test-client',
        GOOGLE_CLIENT_SECRET: 'test-only-secret',
      },
      log: new Log(LogLevel.ERROR),
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v3/certs')
          return MockResponse.json({ keys: [jwk] });
        if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
          tokenCalls++;
          const params = new URLSearchParams(await request.text());
          const verifier = params.get('code_verifier')!;
          const hash = Buffer.from(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
          ).toString('base64url');
          expect(hash).toBe(challenge);
          expect(params.get('redirect_uri')).toBe(`${origin}/api/auth/callback`);
          const token = await new SignJWT({ nonce: mode === 'nonce' ? 'wrong' : nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-google' })
            .setIssuer('https://accounts.google.com')
            .setAudience(mode === 'audience' ? 'another-client' : 'test-client')
            .setSubject('provider-user-123')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(mode === 'signature' ? rogue.privateKey : key.privateKey);
          return MockResponse.json({ id_token: token });
        }
        throw Error(`Unexpected outbound request: ${url.hostname}`);
      },
    }),
  );
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    for (const block of (await readFile(`migrations/${file}`, 'utf8')).split('-- statement')) {
      const sql = block
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim();
      if (sql) await db.prepare(sql).run();
    }
});
afterAll(async () => {
  await mf?.dispose();
});
async function begin() {
  const response = await mf.dispatchFetch(`${origin}/api/auth/google`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      display_name: 'OAuth Settler',
      region_id: 'tagus',
      locale: 'en',
      accept_rules: true,
    }),
  });
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const auth = new URL(url);
  nonce = auth.searchParams.get('nonce')!;
  challenge = auth.searchParams.get('code_challenge')!;
  expect(auth.searchParams.get('scope')).toBe('openid');
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  return {
    state: auth.searchParams.get('state')!,
    cookie: response.headers.get('set-cookie')!.split(';')[0],
  };
}
it('verifies signed provider identity and PKCE, then resumes the same account on another browser', async () => {
  mode = 'valid';
  const flow = await begin();
  const callback = await mf.dispatchFetch(
    `${origin}/api/auth/callback?state=${flow.state}&code=valid-code`,
    { headers: { Cookie: flow.cookie }, redirect: 'manual' },
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe(`${origin}/me`);
  const cookies = callback.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith('world_session='))!;
  expect(session).toContain('HttpOnly');
  expect(session).toContain('SameSite=Lax');
  const state = (await (
    await mf.dispatchFetch(`${origin}/api/me/state`, { headers: { Cookie: session.split(';')[0] } })
  ).json()) as { user: { id: string }; gold_balance: number };
  expect(state.gold_balance).toBe(100);
  const second = await begin();
  const callback2 = await mf.dispatchFetch(
    `${origin}/api/auth/callback?state=${second.state}&code=second-browser`,
    { headers: { Cookie: second.cookie }, redirect: 'manual' },
  );
  const session2 = callback2.headers.getSetCookie().find((c) => c.startsWith('world_session='))!;
  const state2 = (await (
    await mf.dispatchFetch(`${origin}/api/me/state`, {
      headers: { Cookie: session2.split(';')[0] },
    })
  ).json()) as typeof state;
  expect(state2.user.id).toBe(state.user.id);
  expect(state2.gold_balance).toBe(100);
});
it('rejects missing browser state and already-consumed OAuth attempts before exchanging codes', async () => {
  const flow = await begin();
  const before = tokenCalls;
  const wrong = await mf.dispatchFetch(
    `${origin}/api/auth/callback?state=${flow.state}&code=code`,
    { redirect: 'manual' },
  );
  expect(wrong.headers.get('location')).toContain('auth_error');
  expect(tokenCalls).toBe(before);
  const first = await mf.dispatchFetch(
    `${origin}/api/auth/callback?state=${flow.state}&code=code`,
    { headers: { Cookie: flow.cookie }, redirect: 'manual' },
  );
  expect(first.headers.get('location')).toBe(`${origin}/me`);
  const replay = await mf.dispatchFetch(
    `${origin}/api/auth/callback?state=${flow.state}&code=code`,
    { headers: { Cookie: flow.cookie }, redirect: 'manual' },
  );
  expect(replay.headers.get('location')).toContain('auth_error');
  expect(tokenCalls).toBe(before + 1);
});
for (const invalid of ['nonce', 'audience', 'signature'])
  it(`rejects an invalid OAuth ${invalid} without a session`, async () => {
    mode = invalid;
    const flow = await begin();
    const result = await mf.dispatchFetch(
      `${origin}/api/auth/callback?state=${flow.state}&code=invalid`,
      { headers: { Cookie: flow.cookie }, redirect: 'manual' },
    );
    expect(result.headers.get('location')).toContain('auth_error');
    expect(result.headers.getSetCookie().some((c) => c.startsWith('world_session='))).toBe(false);
  });
