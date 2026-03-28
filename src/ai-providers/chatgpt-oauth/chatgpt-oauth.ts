/**
 * ChatGPT OAuth authentication — PKCE flow for ChatGPT Plus/Pro Codex backend.
 *
 * Adapted from opencode-openai-codex-auth plugin. Uses the same OAuth client ID
 * and flow as OpenAI's official Codex CLI.
 */

import { randomBytes, createHash } from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// ==================== Constants ====================

export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const SCOPE = 'openid profile email offline_access'
export const CALLBACK_PORT = 1455

// ==================== PKCE ====================

interface PKCEPair {
  verifier: string
  challenge: string
}

/** Generate a PKCE code_verifier + code_challenge (S256). */
export function generatePKCE(): PKCEPair {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// ==================== State ====================

export function createState(): string {
  return randomBytes(16).toString('hex')
}

// ==================== Token Types ====================

export interface TokenSuccess {
  type: 'success'
  access: string
  refresh: string
  expires: number
}

export interface TokenFailure {
  type: 'failed'
}

export type TokenResult = TokenSuccess | TokenFailure

export interface JWTPayload {
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
  [key: string]: unknown
}

// ==================== Authorization Flow ====================

export interface AuthorizationFlow {
  pkce: PKCEPair
  state: string
  url: string
}

export function createAuthorizationFlow(): AuthorizationFlow {
  const pkce = generatePKCE()
  const state = createState()

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'codex_cli_rs')

  return { pkce, state, url: url.toString() }
}

// ==================== Token Exchange ====================

export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  redirectUri: string = REDIRECT_URI,
): Promise<TokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[chatgpt-oauth] code→token failed:', res.status, text)
    return { type: 'failed' }
  }
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
    console.error('[chatgpt-oauth] token response missing fields:', json)
    return { type: 'failed' }
  }
  return {
    type: 'success',
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
  }
}

// ==================== Token Refresh ====================

export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[chatgpt-oauth] token refresh failed:', res.status, text)
      return { type: 'failed' }
    }
    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!json?.access_token || !json?.refresh_token || typeof json?.expires_in !== 'number') {
      console.error('[chatgpt-oauth] token refresh response missing fields:', json)
      return { type: 'failed' }
    }
    return {
      type: 'success',
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  } catch (err) {
    console.error('[chatgpt-oauth] token refresh error:', err)
    return { type: 'failed' }
  }
}

// ==================== JWT Decode ====================

export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
    return JSON.parse(decoded) as JWTPayload
  } catch {
    return null
  }
}

/** Extract ChatGPT account ID from an access token. */
export function extractAccountId(accessToken: string): string | null {
  const payload = decodeJWT(accessToken)
  return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null
}

// ==================== Local OAuth Callback Server ====================

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Login Successful</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0b;color:#e0e0e0}
.card{text-align:center;padding:3rem;border-radius:16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)}
h1{font-size:1.5rem;margin:0 0 0.5rem;color:#22c55e}p{margin:0;color:#888;font-size:0.9rem}</style>
</head><body><div class="card"><h1>✓ Login Successful</h1><p>You can close this tab and return to Open Alice.</p></div></body></html>`

export interface OAuthServerInfo {
  port: number
  ready: boolean
  close: () => void
  waitForCode: () => Promise<{ code: string } | null>
}

export function startLocalOAuthServer({ state }: { state: string }): Promise<OAuthServerInfo> {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '', 'http://localhost')
      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400
        res.end('State mismatch')
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        res.statusCode = 400
        res.end('Missing authorization code')
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(SUCCESS_HTML)
      ;(server as http.Server & { _lastCode?: string })._lastCode = code
    } catch {
      res.statusCode = 500
      res.end('Internal error')
    }
  })

  return new Promise((resolve) => {
    server
      .listen(CALLBACK_PORT, '127.0.0.1', () => {
        resolve({
          port: CALLBACK_PORT,
          ready: true,
          close: () => server.close(),
          waitForCode: async () => {
            const lastCode = (server as http.Server & { _lastCode?: string })._lastCode
            if (lastCode) {
              // Clear it to prevent multiple reads
              ;(server as http.Server & { _lastCode?: string })._lastCode = undefined
              return { code: lastCode }
            }
            return null
          },
        })
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        console.error('[chatgpt-oauth] Failed to bind port', CALLBACK_PORT, ':', err?.code, '— falling back to manual paste.')
        resolve({
          port: CALLBACK_PORT,
          ready: false,
          close: () => { try { server.close() } catch { /* ok */ } },
          waitForCode: async () => null,
        })
      })
  })
}

// ==================== Browser Opener ====================

const PLATFORM_OPENERS: Record<string, string> = {
  darwin: 'open',
  win32: 'start',
  linux: 'xdg-open',
}

function commandExists(command: string): boolean {
  if (!command) return false
  if (process.platform === 'win32' && command.toLowerCase() === 'start') return true
  const pathValue = process.env.PATH || ''
  const entries = pathValue.split(path.delimiter).filter(Boolean)
  for (const entry of entries) {
    if (fs.existsSync(path.join(entry, command))) return true
  }
  return false
}

/** Open a URL in the default browser. Returns true if a launch was attempted. */
export function openBrowserUrl(url: string): boolean {
  try {
    const opener = PLATFORM_OPENERS[process.platform] || 'xdg-open'
    if (!commandExists(opener)) return false
    const child = spawn(opener, [url], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    child.on('error', () => {})
    return true
  } catch {
    return false
  }
}
