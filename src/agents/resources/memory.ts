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
  // Create the memory directory so the agent can immediately write to it
  mkdirSync(memoryDir, { recursive: true });

  const existingMemory = readMemoryIndex(memoryDir);

  const header = `# Agent Memory

You have a persistent memory directory at: ${memoryDir}/
Memory scope: ${scope}

This memory persists across sessions. Use it to build up knowledge over time.`;

  const memoryContent = existingMemory
    ? `\n\n## Current MEMORY.md\n${existingMemory}`
    : `\n\nNo MEMORY.md exists yet. Create one at ${join(memoryDir, "MEMORY.md")} to start building persistent memory.`;

  const instructions = `

## Memory Instructions
- MEMORY.md is an index file — keep it concise (under 200 lines). Lines after 200 are truncated.
- Store detailed memories in separate files within ${memoryDir}/ and link to them from MEMORY.md.
- Each memory file should use this frontmatter format:
  \`\`\`markdown
  ---
  name: <memory name>
  description: <one-line description>
  type: <user|feedback|project|reference>
  ---
  <memory content>
  \`\`\`
- Update or remove memories that become outdated. Check for existing memories before creating duplicates.
- You have Read, Write, and Edit tools available for managing memory files.`;

  return header + memoryContent + instructions;
}

/**
 * Build a read-only memory block for agents that lack write/edit tools.
 * Does NOT create the memory directory — agents can only consume existing memory.
 */
export function buildReadOnlyMemoryBlock(agentName: string, scope: MemoryScope, cwd: string): string {
  const memoryDir = resolveMemoryDir(agentName, scope, cwd);
  const existingMemory = readMemoryIndex(memoryDir);

  const header = `# Agent Memory (read-only)

Memory scope: ${scope}
You have read-only access to memory. You can reference existing memories but cannot create or modify them.`;

  const memoryContent = existingMemory
    ? `\n\n## Current MEMORY.md\n${existingMemory}`
    : `\n\nNo memory is available yet. Other agents or sessions with write access can create memories for you to consume.`;

  return header + memoryContent;
}
