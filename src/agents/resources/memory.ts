// Memory prompts imported from @tintinweb/pi-subagents 0.23.0 src/memory.ts (MIT).
// Directory names are validated at the frontmatter boundary; Pi's filesystem semantics apply.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { MemoryScope } from '../types.ts';

function resolveMemoryDir(name: string, scope: MemoryScope, cwd: string): string {
  return join(scope === 'user' ? getAgentDir() : join(cwd, '.pi'), scope === 'local' ? 'agent-memory-local' : 'agent-memory', name);
}
function readMemoryIndex(dir: string): string | undefined {
  let content: string;
  try { content = readFileSync(join(dir, 'MEMORY.md'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const lines = content.split('\n');
  return lines.length > 200 ? lines.slice(0, 200).join('\n') + '\n... (truncated at 200 lines)' : content;
}

export function buildMemoryBlock(agentName: string, scope: MemoryScope, cwd: string): string {
  const memoryDir = resolveMemoryDir(agentName, scope, cwd);
  mkdirSync(memoryDir, { recursive: true });

  const existingMemory = readMemoryIndex(memoryDir);

  const header = `# Agent Memory

Persistent memory directory (${scope}): ${memoryDir}/`;

  const memoryContent = existingMemory
    ? `\n\n## Current MEMORY.md\n${existingMemory}`
    : `\n\nCreate ${join(memoryDir, "MEMORY.md")} when you have something to save.`;

  const instructions = `

## Memory Instructions
- Only the first 200 lines of MEMORY.md are loaded. Keep it as an index.
- Save details in separate files in this directory and link to them from MEMORY.md.
- Each memory file should use this frontmatter format:
  \`\`\`markdown
  ---
  name: <memory name>
  description: <one-line description>
  type: <user|feedback|project|reference>
  ---
  <memory content>
  \`\`\`
- Check for duplicates before adding a memory. Update or remove outdated entries.`;

  return header + memoryContent + instructions;
}

/** Missing memory is normal; only the writable variant creates the directory. */
export function buildReadOnlyMemoryBlock(agentName: string, scope: MemoryScope, cwd: string): string {
  const memoryDir = resolveMemoryDir(agentName, scope, cwd);
  const existingMemory = readMemoryIndex(memoryDir);

  const header = `# Agent Memory (read-only)

Memory directory (${scope}): ${memoryDir}/
Use existing memories as context. Do not modify them.`;

  const memoryContent = existingMemory
    ? `\n\n## Current MEMORY.md\n${existingMemory}`
    : `\n\nNo memory is available.`;

  return header + memoryContent;
}
