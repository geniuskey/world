import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Player } from '../shared/game';
import { loginSchema } from '../shared/schemas';
import { ApiError, type Ctx } from './types';
import { join } from './game';

export const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const random = () => crypto.randomUUID() + crypto.randomUUID();
const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
export function localAuth(c: Ctx) {
  return (
    c.env.DEV_AUTH_ENABLED === 'true' &&
    loopback(new URL(c.req.url).hostname) &&
    loopback(new URL(c.env.APP_ORIGIN).hostname)
  );
}
function cookieOptions(c: Ctx, maxAge: number) {
  return {
    httpOnly: true,
    secure: !loopback(new URL(c.req.url).hostname),
    sameSite: 'Lax' as const,
    path: '/',
    maxAge,
  };
}
export async function authenticate(c: Ctx) {
  const token = getCookie(c, 'world_session');
  if (!token || token.length > 150) throw new ApiError('UNAUTHENTICATED', 401);
  const user = await c
    .get('db')
    .first<Player>(
      `SELECT u.id,u.role,u.is_test,p.display_name,p.locale,p.flag_style FROM sessions s JOIN users u ON u.id=s.user_id JOIN profiles p ON p.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`,
      await sha256(token),
      c.get('now'),
    );
  if (!user) throw new ApiError('UNAUTHENTICATED', 401);
  c.set('user', user);
  return user;
}
export async function newSession(c: Ctx, user: string) {
  const token = random();
  await c
    .get('db')
    .run('INSERT INTO sessions VALUES(?,?,?)', await sha256(token), user, c.get('now') + 604800);
  setCookie(c, 'world_session', token, cookieOptions(c, 604800));
}
export async function upsertUser(
  c: Ctx,
  provider: string,
  subject: string,
  profile: ReturnType<typeof loginSchema.parse>,
) {
  const db = c.get('db');
  const now = c.get('now');
  const userId = crypto.randomUUID();
  await db.batch([
    db.statement(
      'INSERT INTO users(id,auth_provider,provider_subject,created_at,is_test) VALUES(?,?,?,?,?) ON CONFLICT(auth_provider,provider_subject) DO NOTHING',
      [userId, provider, subject, now, provider === 'local' ? 1 : 0],
    ),
    db.statement(
      'INSERT INTO profiles(user_id,display_name,locale,created_at) SELECT id,?,?,? FROM users WHERE auth_provider=? AND provider_subject=? ON CONFLICT(user_id) DO NOTHING',
      [profile.display_name, profile.locale, now, provider, subject],
    ),
  ]);
  const user = await db.first<{ id: string; status: string }>(
    'SELECT id,status FROM users WHERE auth_provider=? AND provider_subject=?',
    provider,
    subject,
  );
  if (user?.status !== 'active') throw new ApiError('ACCOUNT_BLOCKED', 403);
  await join(db, user.id, profile.region_id, now);
  await newSession(c, user.id);
  return user.id;
}
export async function devLogin(c: Ctx, body: unknown) {
  if (!localAuth(c)) throw new ApiError('FEATURE_DISABLED', 404);
  const profile = loginSchema.parse(body);
  return upsertUser(c, 'local', profile.display_name.toLocaleLowerCase(), profile);
}
export async function startOAuth(c: Ctx, body: unknown) {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET)
    throw new ApiError('AUTH_NOT_CONFIGURED', 503);
  const profile = loginSchema.parse(body);
  const state = random(),
    nonce = random(),
    verifier = random();
  await c
    .get('db')
    .run(
      'INSERT INTO oauth_attempts VALUES(?,?,?,?,?)',
      await sha256(state),
      nonce,
      verifier,
      JSON.stringify(profile),
      c.get('now') + 600,
    );
  setCookie(c, 'world_oauth', state, cookieOptions(c, 600));
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const challenge = btoa(String.fromCharCode(...digest))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${c.env.APP_ORIGIN}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export async function finishOAuth(c: Ctx) {
  const state = c.req.query('state'),
    code = c.req.query('code');
  if (
    !state ||
    state !== getCookie(c, 'world_oauth') ||
    !code ||
    state.length > 150 ||
    code.length > 4096
  )
    throw new ApiError('INVALID_OAUTH_STATE', 400);
  deleteCookie(c, 'world_oauth', { path: '/' });
  const attempt = await c
    .get('db')
    .first<{ nonce: string; verifier: string; profile_json: string }>(
      'DELETE FROM oauth_attempts WHERE state_hash=? AND expires_at>? RETURNING nonce,verifier,profile_json',
      await sha256(state),
      c.get('now'),
    );
  if (!attempt) throw new ApiError('INVALID_OAUTH_STATE', 400);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: `${c.env.APP_ORIGIN}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new ApiError('OAUTH_FAILED', 401);
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new ApiError('OAUTH_FAILED', 401);
  let subject: string;
  try {
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: c.env.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'],
    });
    if (
      payload.nonce !== attempt.nonce ||
      !payload.sub ||
      (payload.azp && payload.azp !== c.env.GOOGLE_CLIENT_ID)
    )
      throw Error('Invalid identity');
    subject = payload.sub;
  } catch {
    throw new ApiError('OAUTH_FAILED', 401);
  }
  await upsertUser(c, 'google', subject, loginSchema.parse(JSON.parse(attempt.profile_json)));
  return c.redirect(`${c.env.APP_ORIGIN}/me`);
}
export async function logout(c: Ctx) {
  const token = getCookie(c, 'world_session');
  if (token) await c.get('db').run('DELETE FROM sessions WHERE token_hash=?', await sha256(token));
  deleteCookie(c, 'world_session', { path: '/' });
}
