/**
 * ChatGPT OAuth token store — persists tokens to data/config/chatgpt-oauth.json.
 *
 * File-based storage matching OpenAlice's file-driven architecture (no database).
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { resolve, dirname } from 'path'

const TOKEN_FILE = resolve('data/config/chatgpt-oauth.json')

export interface ChatGPTTokenData {
  access: string
  refresh: string
  expires: number
  accountId: string
}

/** Load saved tokens from disk. Returns null if no tokens saved or file missing. */
export async function loadTokens(): Promise<ChatGPTTokenData | null> {
  try {
    const raw = await readFile(TOKEN_FILE, 'utf-8')
    const data = JSON.parse(raw)
    if (!data?.access || !data?.refresh || !data?.expires || !data?.accountId) {
      return null
    }
    return data as ChatGPTTokenData
  } catch {
    return null
  }
}

/** Save tokens to disk. */
export async function saveTokens(tokens: ChatGPTTokenData): Promise<void> {
  await mkdir(dirname(TOKEN_FILE), { recursive: true })
  await writeFile(TOKEN_FILE, JSON.stringify(tokens, null, 2) + '\n')
}

/** Clear saved tokens (logout). */
export async function clearTokens(): Promise<void> {
  try {
    await unlink(TOKEN_FILE)
  } catch {
    /* ENOENT is fine */
  }
}

/** Check if tokens are expired (with 60s buffer). */
export function isTokenExpired(tokens: ChatGPTTokenData): boolean {
  return tokens.expires < Date.now() + 60_000
}
