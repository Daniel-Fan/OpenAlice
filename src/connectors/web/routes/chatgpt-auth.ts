/**
 * ChatGPT OAuth API routes — handles the browser-based login flow.
 *
 * Endpoints:
 *   POST /start    — Initiates OAuth flow (PKCE + callback server + browser)
 *   POST /poll     — Poll for auto-mode callback completion
 *   POST /callback — Manual code submission fallback
 *   GET  /status   — Check authentication status
 *   POST /logout   — Clear saved tokens
 */

import { Hono } from 'hono'
import {
  createAuthorizationFlow,
  exchangeAuthorizationCode,
  extractAccountId,
  startLocalOAuthServer,
  openBrowserUrl,
  type OAuthServerInfo,
} from '../../../ai-providers/chatgpt-oauth/chatgpt-oauth.js'
import {
  loadTokens,
  saveTokens,
  clearTokens,
  isTokenExpired,
  type ChatGPTTokenData,
} from '../../../ai-providers/chatgpt-oauth/chatgpt-token-store.js'

// Active OAuth flow state (one flow at a time)
let activeFlow: {
  pkce: { verifier: string; challenge: string }
  state: string
  server: OAuthServerInfo | null
} | null = null

export function createChatGPTAuthRoutes() {
  const app = new Hono()

  /**
   * POST /start — Initiate OAuth flow.
   * Returns { url, autoMode } to the frontend.
   */
  app.post('/start', async (c) => {
    try {
      // Clean up any previous flow
      if (activeFlow?.server) {
        activeFlow.server.close()
      }

      const { pkce, state, url } = createAuthorizationFlow()

      // Start local callback server
      const server = await startLocalOAuthServer({ state })

      activeFlow = { pkce, state, server }

      // Attempt to open browser
      openBrowserUrl(url)

      return c.json({
        url,
        autoMode: server.ready,
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * POST /poll — Poll for auto-mode callback completion.
   * Returns { success, accountId } when code received, { pending: true } while waiting.
   */
  app.post('/poll', async (c) => {
    try {
      if (!activeFlow?.server?.ready) {
        return c.json({ error: 'No active OAuth flow or auto-mode not available' }, 400)
      }

      const result = await activeFlow.server.waitForCode()

      if (!result) {
        return c.json({ pending: true })
      }

      const code = result.code
      const verifier = activeFlow.pkce.verifier

      // Clean up server IMMEDIATELY to prevent concurrent requests
      activeFlow.server.close()
      activeFlow = null

      // Exchange code for tokens
      const tokens = await exchangeAuthorizationCode(code, verifier)

      if (tokens.type === 'failed') {
        return c.json({ error: 'Token exchange failed' }, 400)
      }

      // Extract account ID from JWT
      const accountId = extractAccountId(tokens.access)
      if (!accountId) {
        return c.json({ error: 'Could not extract ChatGPT account ID from token' }, 400)
      }

      // Save tokens
      const tokenData: ChatGPTTokenData = {
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        accountId,
      }
      await saveTokens(tokenData)

      return c.json({ success: true, accountId })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * POST /callback — Manual code submission (fallback when auto-mode fails).
   * Accepts { code } or { url } (full redirect URL).
   */
  app.post('/callback', async (c) => {
    try {
      if (!activeFlow) {
        return c.json({ error: 'No active OAuth flow. Call /start first.' }, 400)
      }

      const body = await c.req.json<{ code?: string; url?: string }>()
      let code = body.code

      // Parse code from full redirect URL if provided
      if (!code && body.url) {
        try {
          const url = new URL(body.url)
          code = url.searchParams.get('code') ?? undefined
        } catch { /* not a URL */ }
      }

      if (!code) {
        return c.json({ error: 'No authorization code provided' }, 400)
      }

      // Exchange code for tokens
      const tokens = await exchangeAuthorizationCode(
        code,
        activeFlow.pkce.verifier,
      )

      // Clean up
      if (activeFlow.server) {
        activeFlow.server.close()
      }
      activeFlow = null

      if (tokens.type === 'failed') {
        return c.json({ error: 'Token exchange failed' }, 400)
      }

      // Extract account ID
      const accountId = extractAccountId(tokens.access)
      if (!accountId) {
        return c.json({ error: 'Could not extract ChatGPT account ID from token' }, 400)
      }

      // Save tokens
      const tokenData: ChatGPTTokenData = {
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
        accountId,
      }
      await saveTokens(tokenData)

      return c.json({ success: true, accountId })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * GET /status — Check authentication status.
   */
  app.get('/status', async (c) => {
    try {
      const tokens = await loadTokens()
      if (!tokens) {
        return c.json({ authenticated: false })
      }
      return c.json({
        authenticated: true,
        accountId: tokens.accountId,
        expired: isTokenExpired(tokens),
        expiresAt: tokens.expires,
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /**
   * POST /logout — Clear saved tokens.
   */
  app.post('/logout', async (c) => {
    try {
      await clearTokens()
      return c.json({ success: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return app
}
