import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { JsonStore } from '../../runtime/json-store.ts';
import { decodeWorkflowEntry, type WorkflowEntryData } from './entry.ts';

/** Each run owns a script copy and journal; snapshot updates use the shared atomic file protocol. */
export function createWorkflowFiles(ownerSessionId: string, id: string, script: string, agentDir = getAgentDir()) {
  const directory = join(agentDir, 'pi-suite', 'agents', 'workflows', ownerSessionId, id);
  mkdirSync(dirname(directory), {recursive: true, mode: 0o700});
  mkdirSync(directory, {mode: 0o700});
  const scriptPath = join(directory, 'script.js'), journalPath = join(directory, 'journal.jsonl');
  writeFileSync(scriptPath, script, {flag: 'wx', mode: 0o600});
  writeFileSync(journalPath, '', {flag: 'wx', mode: 0o600});
  return {scriptPath, journalPath, recordPath: join(directory, 'run.json'), resultPath: join(directory, 'result.txt')};
}
export class WorkflowStore extends JsonStore<WorkflowEntryData> {
  constructor(initial: WorkflowEntryData) { super(initial.recordPath, initial, decodeWorkflowEntry, 'WORKFLOW'); }
  save(data: WorkflowEntryData): Promise<void> { return this.mutate(current => { Object.assign(current, data); }); }
}
export function readWorkflowSnapshot(path: string): WorkflowEntryData {
  return decodeWorkflowEntry(JSON.parse(readFileSync(path, 'utf8')));
}
