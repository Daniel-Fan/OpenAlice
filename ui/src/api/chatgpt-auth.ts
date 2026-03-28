/** ChatGPT OAuth API client — frontend methods for the OAuth flow. */

import { fetchJson, headers } from './client'

export interface ChatGPTAuthStartResult {
  url: string
  autoMode: boolean
}

export interface ChatGPTAuthPollResult {
  pending?: boolean
  success?: boolean
  accountId?: string
  error?: string
}

export interface ChatGPTAuthStatus {
  authenticated: boolean
  accountId?: string
  expired?: boolean
  expiresAt?: number
}

export const chatgptAuthApi = {
  /** Start the OAuth flow. Returns the auth URL and whether auto-mode is available. */
  start: () =>
    fetchJson<ChatGPTAuthStartResult>('/api/chatgpt-auth/start', {
      method: 'POST',
      headers,
    }),

  /** Poll for auto-mode callback completion. */
  poll: () =>
    fetchJson<ChatGPTAuthPollResult>('/api/chatgpt-auth/poll', {
      method: 'POST',
      headers,
    }),

  /** Manual code submission (fallback). */
  callback: (code: string) =>
    fetchJson<{ success: boolean; accountId?: string; error?: string }>('/api/chatgpt-auth/callback', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code }),
    }),

  /** Check authentication status. */
  status: () =>
    fetchJson<ChatGPTAuthStatus>('/api/chatgpt-auth/status'),

  /** Clear saved tokens (logout). */
  logout: () =>
    fetchJson<{ success: boolean }>('/api/chatgpt-auth/logout', {
      method: 'POST',
      headers,
    }),
}
