import { tool } from 'ai'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function createFsTools() {
  return {
    readFile: tool({
      description:
        'Read the contents of a local file from the OpenAlice filesystem.\n\n' +
        'Use this to read configuration files, markdown documentation (like data/brain/heartbeat.md), ' +
        'or any other text-based file in the project. The path should be relative to the OpenAlice project root.',
      inputSchema: z.object({
        path: z.string().describe('The relative path to the file to read, e.g., "data/brain/heartbeat.md"'),
      }),
      execute: async ({ path }) => {
        try {
          const absolutePath = resolve(path)
          const content = await readFile(absolutePath, 'utf-8')
          return { success: true, content }
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      },
    }),
  }
}
