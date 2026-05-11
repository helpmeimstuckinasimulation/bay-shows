/**
 * Bay Shows — Google OAuth Worker
 * Handles PKCE authorization code flow for Google Drive access.
 *
 * Endpoints:
 *   GET /auth      — redirects to Google consent screen
 *   GET /callback  — exchanges code for token, redirects back to app
 *   GET /refresh   — uses stored refresh token to mint a new access token
 *
 * Environment variables (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
 *   GOOGLE_CLIENT_ID      — OAuth 2.0 client ID (plain text)
 *   GOOGLE_CLIENT_SECRET  — OAuth 2.0 client secret (encrypted)
 *
 * KV binding (Cloudflare dashboard → Worker → Settings → Bindings):
 *   BAY_SHOWS_KV          — KV namespace for PKCE state + refresh token storage
 */

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE            = 'https://www.googleapis.com/auth/drive.file openid email';

const WORKER_BASE  = 'https://bay-shows-auth.dranahan.workers.dev';
const REDIRECT_URI = WORKER_BASE + '/callback';
const APP_CALLBACK = 'https://helpmeimstuckinasimulation.github.io/bay-shows/auth.html';
const APP_ORIGIN   = 'https://helpmeimstuckinasimulation.github.io';

// KV key for the refresh token. Single-user app so one key is fine.
const REFRESH_TOKEN_KEY = 'refresh_token:darin';

// ── CORS headers (needed for /refresh, called directly from the PWA) ─

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':      APP_ORIGIN,
    'Access-Control-Allow-Methods':     'GET, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// ── PKCE helpers ──────────────────────────────────────────────────

async function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64url(array);
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

function base64url(buffer) {
  return btoa(String.fromCharCode.apply(null, buffer))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64url(array);
}

// ── Redirect helper ───────────────────────────────────────────────

function redirectToApp(params) {
  const url = new URL(APP_CALLBACK);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  return Response.redirect(url.toString(), 302);
}

// ── /auth handler ─────────────────────────────────────────────────

async function handleAuth(request, env) {
  const codeVerifier  = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state         = randomState();

  // Store PKCE verifier in KV with 10-minute TTL
  await env.BAY_SHOWS_KV.put('pkce:' + state, codeVerifier, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id:             env.GOOGLE_CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    response_type:         'code',
    scope:                 SCOPE,
    state:                 state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    access_type:           'offline',  // offline = Google issues a refresh token
    prompt:                'consent',  // force consent so refresh token is always returned
  });

  return Response.redirect(GOOGLE_AUTH_URL + '?' + params.toString(), 302);
}

// ── /callback handler ─────────────────────────────────────────────

async function handleCallback(request, env) {
  const url   = new URL(request.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return redirectToApp({ error: 'google_error:' + error });
  if (!code || !state) return redirectToApp({ error: 'missing_params' });

  // Retrieve and delete the PKCE verifier
  const codeVerifier = await env.BAY_SHOWS_KV.get('pkce:' + state);
  if (!codeVerifier) return redirectToApp({ error: 'invalid_state' });
  await env.BAY_SHOWS_KV.delete('pkce:' + state);

  // Exchange code for tokens
  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResp.ok) return redirectToApp({ error: 'token_exchange_failed' });

  const tokens = await tokenResp.json();

  // Store the refresh token server-side in KV — never sent to the browser.
  // Google only returns refresh_token when access_type=offline + prompt=consent.
  if (tokens.refresh_token) {
    await env.BAY_SHOWS_KV.put(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }

  // Send only the short-lived access token back to the browser.
  return redirectToApp({
    access_token: tokens.access_token,
    expires_in:   tokens.expires_in || 3600,
  });
}

// ── /refresh handler ──────────────────────────────────────────────
// Called by index.html when the stored access token has expired.
// Uses the server-side refresh token to mint a new access token.
// Returns JSON { access_token, expires_in } — never exposes the refresh token.

async function handleRefresh(request, env) {
  const refreshToken = await env.BAY_SHOWS_KV.get(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    return new Response(JSON.stringify({ error: 'no_refresh_token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });

  if (!tokenResp.ok) {
    const detail = await tokenResp.text();
    return new Response(JSON.stringify({ error: 'google_refresh_failed', detail }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const tokens = await tokenResp.json();

  // Google occasionally rotates the refresh token — store the new one if present
  if (tokens.refresh_token) {
    await env.BAY_SHOWS_KV.put(REFRESH_TOKEN_KEY, tokens.refresh_token);
  }

  return new Response(JSON.stringify({
    access_token: tokens.access_token,
    expires_in:   tokens.expires_in || 3600,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── Main fetch handler (ES module format) ────────────────────────
// ES modules receive env as a parameter — no globals needed.
// Cloudflare auto-detects ES module format from the export default below.

export default {
  async fetch(request, env) {
    const url      = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (pathname === '/auth')     return handleAuth(request, env);
    if (pathname === '/callback') return handleCallback(request, env);
    if (pathname === '/refresh')  return handleRefresh(request, env);

    return new Response('Bay Shows Auth Worker — OK', { status: 200 });
  }
};
