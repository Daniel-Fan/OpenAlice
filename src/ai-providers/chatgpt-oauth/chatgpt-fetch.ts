/**
 * Custom fetch wrapper for ChatGPT Codex backend API.
 *
 * Intercepts Vercel AI SDK requests and transforms them for the ChatGPT backend:
 * 1. Token management (refresh if expired)
 * 2. URL rewriting (/responses → /codex/responses)
 * 3. Request body transformation (model normalization, reasoning defaults, store: false)
 * 4. Header injection (OAuth bearer, account ID, originator)
 * 5. Response handling (SSE content-type for streaming, SSE→JSON for non-streaming)
 */

import { refreshAccessToken } from './chatgpt-oauth.js'
import { loadTokens, saveTokens, isTokenExpired, type ChatGPTTokenData } from './chatgpt-token-store.js'

// ==================== Constants ====================

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

// ==================== Model Normalization ====================

/**
 * Normalize model names to canonical Codex backend models.
 * Follows the same normalization logic as the opencode-openai-codex-auth plugin.
 */
export function normalizeModel(model: string): string {
  const m = model.toLowerCase().trim()

  // GPT-5.4 general family
  if (m.startsWith('gpt-5.4')) return 'gpt-5.4'

  // GPT-5.3 Codex family
  if (m.startsWith('gpt-5.3-codex')) return 'gpt-5.3-codex'

  // GPT-5.2 Codex family
  if (m.startsWith('gpt-5.2-codex')) return 'gpt-5.2-codex'

  // GPT-5.1 Codex Max family
  if (m.startsWith('gpt-5.1-codex-max')) return 'gpt-5.1-codex-max'

  // GPT-5.1 Codex Mini family
  if (m.startsWith('gpt-5.1-codex-mini') || m === 'codex-mini-latest') return 'gpt-5.1-codex-mini'

  // GPT-5.1 Codex family
  if (m.startsWith('gpt-5.1-codex')) return 'gpt-5.1-codex'

  // GPT-5.2 general family
  if (m.startsWith('gpt-5.2')) return 'gpt-5.2'

  // GPT-5.1 general family
  if (m.startsWith('gpt-5.1')) return 'gpt-5.1'

  // Legacy GPT-5.0 → GPT-5.1 mappings
  if (m.startsWith('gpt-5-codex-mini') || m === 'codex-mini') return 'gpt-5.1-codex-mini'
  if (m.startsWith('gpt-5-codex')) return 'gpt-5.1-codex'
  if (m.startsWith('gpt-5')) return 'gpt-5.1'

  return model // Pass through unknown models as-is
}

/** Check if a model is in the Codex family (needs special reasoning handling). */
function isCodexModel(model: string): boolean {
  return model.includes('codex')
}

/** Check if a model is Codex Mini (needs effort clamping). */
function isCodexMini(model: string): boolean {
  return model.includes('codex-mini')
}

// ==================== Request Body Transformation ====================

interface RequestBody {
  model: string
  store?: boolean
  stream?: boolean
  instructions?: string
  input?: Array<{ id?: string; type: string; role?: string; [key: string]: unknown }>
  tools?: unknown
  reasoning?: { effort?: string; summary?: string }
  text?: { verbosity?: string }
  include?: string[]
  max_output_tokens?: number
  [key: string]: unknown
}

function transformRequestBody(body: RequestBody): RequestBody {
  const transformed = { ...body }

  // Normalize model
  transformed.model = normalizeModel(body.model)

  // Stateless operation — required for ChatGPT backend
  transformed.store = false
  // Always set stream=true for API (ChatGPT backend strictly requires SSE streams)
  transformed.stream = true
  transformed.include = [...(body.include || []), 'reasoning.encrypted_content']
  // Deduplicate
  transformed.include = [...new Set(transformed.include)]

  // Default reasoning config (matches Codex CLI defaults)
  if (!transformed.reasoning) {
    transformed.reasoning = {}
  }
  const effort = transformed.reasoning.effort || 'medium'
  // Normalize 'minimal' to 'low' for Codex models
  let normalizedEffort = effort === 'minimal' ? 'low' : effort
  // Clamp Codex Mini to 'medium' minimum (or 'high' if requested)
  if (isCodexMini(transformed.model)) {
    if (['low', 'minimal', 'none'].includes(normalizedEffort)) {
      normalizedEffort = 'medium'
    }
  }
  transformed.reasoning.effort = normalizedEffort
  if (!transformed.reasoning.summary) {
    transformed.reasoning.summary = 'auto'
  }

  // Default text verbosity
  if (!transformed.text) {
    transformed.text = {}
  }
  if (!transformed.text.verbosity) {
    transformed.text.verbosity = 'medium'
  }

  // ChatGPT backend requires 'instructions' field
  if (transformed.instructions === undefined) {
    transformed.instructions = ''
  }

  // Remove unsupported parameters
  delete transformed.max_output_tokens
  delete (transformed as any).max_completion_tokens

  // Filter input array for stateless Codex API
  if (transformed.input) {
    transformed.input = transformed.input
      .filter((item) => {
        // Remove AI SDK constructs not supported by Codex API
        if (item.type === 'item_reference') return false
        // Skip previous server-side response IDs
        if (typeof item.id === 'string' && item.id.startsWith('rs_')) return false
        return true
      })
      .map((item) => {
        // Strip IDs from all items (Codex API stateless mode)
        if (item.id) {
          const { id, ...rest } = item
          return rest
        }
        return item
      })

    // Handle orphaned function_call_output items (where function_call was an item_reference that got filtered)
    // Instead of removing orphans (which causes infinite loops as LLM loses tool results),
    // convert them to messages to preserve context while avoiding API errors.
    const functionCallIds = new Set<string>()
    for (const item of transformed.input) {
      if (item.call_id && typeof item.call_id === 'string' && item.type === 'function_call') {
        functionCallIds.add(item.call_id.trim())
      }
    }

    transformed.input = transformed.input.map((item) => {
      if (item.type === 'function_call_output' && item.call_id && typeof item.call_id === 'string') {
        const callId = item.call_id.trim()
        if (!functionCallIds.has(callId)) {
          // Orphaned tool output -> convert to message
          const toolName = typeof item.name === 'string' ? item.name : 'tool'
          let text = ''
          try {
            text = typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
          } catch {
            text = String(item.output ?? '')
          }
          if (text.length > 16000) text = text.slice(0, 16000) + '\\n...[truncated]'
          
          return {
            type: 'message',
            role: 'assistant',
            content: `[Previous ${toolName} result; call_id=${callId}]: ${text}`,
          }
        }
      }
      return item
    })
  }

  return transformed
}

// ==================== URL Rewriting ====================

function rewriteUrlForCodex(url: string): string {
  return url.replace('/responses', '/codex/responses')
}

// ==================== Headers ====================

function createCodexHeaders(
  init: RequestInit | undefined,
  accountId: string,
  accessToken: string,
): Headers {
  const headers = new Headers(init?.headers ?? {})
  headers.delete('x-api-key')
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set('chatgpt-account-id', accountId)
  headers.set('OpenAI-Beta', 'responses=experimental')
  headers.set('originator', 'codex_cli_rs')
  headers.set('accept', 'text/event-stream')
  return headers
}

// ==================== SSE → JSON Conversion ====================

/**
 * Convert an SSE response to JSON (for non-streaming generateText() calls).
 * The Codex backend always returns SSE, but Vercel AI SDK's generateText()
 * expects a JSON response.
 */
async function convertSseToJson(response: Response): Promise<Response> {
  const text = await response.text()
  const lines = text.split('\n')
  let lastData: unknown = null

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        // Look for the response.completed event which has the full response
        if (parsed.type === 'response.completed' && parsed.response) {
          lastData = parsed.response
        } else if (parsed.type === 'response.done' && parsed.response) {
          lastData = parsed.response
        } else {
          lastData = parsed
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  if (!lastData) {
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(lastData), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ==================== Rate Limit 404 Mapping ====================

/**
 * The Codex backend returns 404 for usage limit errors.
 * Map these to 429 so the SDK can retry properly.
 */
async function mapUsageLimit404(response: Response): Promise<Response | null> {
  if (response.status !== 404) return null

  const clone = response.clone()
  let text = ''
  try { text = await clone.text() } catch { return null }
  if (!text) return null

  let code = ''
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const err = parsed?.error as Record<string, unknown> | undefined
    code = (err?.code ?? err?.type ?? '').toString()
  } catch { /* not JSON */ }

  const haystack = `${code} ${text}`.toLowerCase()
  if (!/usage_limit_reached|usage_not_included|rate_limit_exceeded|usage limit/i.test(haystack)) {
    return null
  }

  return new Response(text, {
    status: 429,
    statusText: 'Too Many Requests',
    headers: response.headers,
  })
}

// ==================== Public: Create Custom Fetch ====================

/**
 * Create a custom fetch function for the Vercel AI SDK's OpenAI provider.
 *
 * This fetch wrapper intercepts all requests and transforms them for the
 * ChatGPT Codex backend API, handling token management, URL rewriting,
 * request transformation, and response conversion.
 */
export function createChatGPTFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Step 1: Load and refresh tokens if needed
    let tokens = await loadTokens()
    if (!tokens) {
      throw new Error('[chatgpt-oauth] Not authenticated. Please login via the AI Provider settings.')
    }

    if (isTokenExpired(tokens)) {
      const refreshResult = await refreshAccessToken(tokens.refresh)
      if (refreshResult.type === 'failed') {
        throw new Error('[chatgpt-oauth] Token refresh failed. Please re-login via the AI Provider settings.')
      }
      tokens = {
        access: refreshResult.access,
        refresh: refreshResult.refresh,
        expires: refreshResult.expires,
        accountId: tokens.accountId,
      }
      await saveTokens(tokens)
    }

    // Step 2: Extract and rewrite URL
    const originalUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const url = rewriteUrlForCodex(originalUrl)

    // Step 3: Transform request body
    let requestInit = init
    let isStreaming = false

    if (init?.body) {
      try {
        const body = JSON.parse(init.body as string) as RequestBody
        isStreaming = body.stream === true
        const transformedBody = transformRequestBody(body)
        requestInit = { ...init, body: JSON.stringify(transformedBody) }
      } catch (err) {
        console.error('[chatgpt-oauth] Error transforming request body:', err)
      }
    }

    // Step 4: Create headers with OAuth
    const headers = createCodexHeaders(requestInit, tokens.accountId, tokens.access)

    // Step 5: Send request
    const response = await fetch(url, {
      ...requestInit,
      headers,
    })

    // Step 6: Handle errors (map 404 usage limits to 429)
    if (!response.ok) {
      const mapped = await mapUsageLimit404(response)
      return mapped ?? response
    }

    // Step 7: Handle success
    // Ensure content-type is correct for SSE
    const responseHeaders = new Headers(response.headers)
    if (!responseHeaders.has('content-type')) {
      responseHeaders.set('content-type', 'text/event-stream')
    }

    // For non-streaming (generateText), convert SSE to JSON
    if (!isStreaming) {
      return await convertSseToJson(response)
    }

    // For streaming (streamText), pass through SSE
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }
}
