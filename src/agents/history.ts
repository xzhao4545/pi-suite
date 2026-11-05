import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getAgentDir, SettingsManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import type { SuiteConfig } from '../runtime/config.ts';
import { ToolError } from '../runtime/errors.ts';
import { agentTypes } from './catalog.ts';
import { AGENT_ENTRY, decodeAgentRecord, readAgentSession } from './records.ts';
import { active, recordWorkspace, type AgentRecord, type ParentScope } from './types.ts';
import { resourcePath } from './resources/loader.ts';
import { WORKFLOW_ENTRY_TYPE, decodeWorkflowEntry } from './workflow/entry.ts';
import { readWorkflowSnapshot } from './workflow/store.ts';

export type SavedAgentRecord = {record: AgentRecord; updatedAt: number};
type SavedReference = {path: string; cwd?: string};
type SavedFile = {stamp: string; records: SavedAgentRecord[]; sessions: SavedReference[]; workflows: SavedReference[]; leafId?: string | null};
/** Parsed-file cache only; AgentManager remains the sole owner of runtime/history records. */
export class AgentHistory {
  private files = new Map<string, SavedFile>();
  private async directory(path: string): Promise<string[]> {
    try { return (await readdir(path)).filter(name => name.endsWith('.jsonl')).map(name => join(path, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async scan(scope: ParentScope, config: SuiteConfig, signal?: AbortSignal): Promise<SavedAgentRecord[]> {
    const cwd = scope.run?.configCwd ?? scope.ctx.cwd, agentDir = getAgentDir();
    const trusted = scope.run?.configTrusted ?? scope.ctx.isProjectTrusted();
    const settings = SettingsManager.create(cwd, agentDir, {projectTrusted: trusted});
    const customDirs = new Set([scope.ctx.sessionManager.getSessionDir(), process.env.PI_CODING_AGENT_SESSION_DIR,
      settings.getSessionDir(), ...agentTypes(cwd, agentDir, {trusted, packageGate: config.agents.packageAgents})
        .map(type => type.sessionDir)].filter((dir): dir is string => Boolean(dir)).map(dir => resourcePath(dir, cwd)));
    const defaultRoot = join(agentDir, 'sessions');
    let defaultDirs: string[] = [];
    try { defaultDirs = (await readdir(defaultRoot, {withFileTypes: true})).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => join(defaultRoot, entry.name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const groups = await Promise.all([...new Set([...defaultDirs, ...customDirs])].map(dir => this.directory(dir)));
    const pending = groups.flat().map(path => ({path, workflow: false}));
    const seen = new Set<string>(), merged = new Map<string, SavedAgentRecord>();
    const add = (candidate: SavedAgentRecord) => {
      if (recordWorkspace(candidate.record) !== cwd) return;
      const old = merged.get(candidate.record.runId);
      if (!old) { merged.set(candidate.record.runId, candidate); return; }
      const [first, last] = old.updatedAt <= candidate.updatedAt ? [old, candidate] : [candidate, old];
      // Workflow snapshots deliberately omit result bodies. They must not erase the SDK's
      // final result or turn a settled run back into a stale startup reference.
      const record = {...first.record, ...last.record, result: last.record.result ?? first.record.result};
      if (!active(first.record.state) && active(last.record.state)) Object.assign(record, {
        state: first.record.state, endedAt: first.record.endedAt, endLeafId: first.record.endLeafId, error: first.record.error});
      merged.set(record.runId, {record, updatedAt: last.updatedAt});
    };
    const follow = (file: SavedFile) => {
      for (const candidate of file.records) add(candidate);
      // A cache belongs to the file, not the workspace that first read it. Apply the
      // query scope here so switching projects still follows their external references.
      const applies = (reference: SavedReference) => reference.cwd === undefined || reference.cwd === cwd;
      pending.push(...file.sessions.filter(applies).map(({path}) => ({path, workflow: false})),
        ...file.workflows.filter(applies).map(({path}) => ({path, workflow: true})));
    };
    // An in-memory parent still has durable child references outside the default roots.
    const current = this.entries(scope.ctx.sessionManager.getEntries(), 'current session');
    follow(current);
    for (let index = 0; index < pending.length; index++) {
      signal?.throwIfAborted();
      const item = pending[index], path = resolve(item.path);
      if (seen.has(path)) continue;
      seen.add(path);
      const stats = await stat(path), stamp = `${stats.mtimeMs}:${stats.size}`;
      let file = this.files.get(path);
      if (!file || file.stamp !== stamp) {
        if (item.workflow) {
          const data = readWorkflowSnapshot(path);
          file = {stamp, records: data.children.map(record => ({record, updatedAt: stats.mtimeMs})),
            sessions: data.children.flatMap(record => record.sessionFile ? [{path: record.sessionFile, cwd: recordWorkspace(record)}] : []), workflows: []};
        } else {
          const manager = readAgentSession(path);
          file = {...this.entries(manager.getEntries(), path), stamp, leafId: manager.getLeafId()};
          const parent = manager.getHeader()?.parentSession;
          if (parent) file.sessions.push({path: parent});
        }
        this.files.set(path, file);
      }
      follow(file);
    }
    for (const path of this.files.keys()) if (!seen.has(path)) this.files.delete(path);
    return [...merged.values()].map(candidate => {
      const record = candidate.record;
      if (!active(record.state)) return candidate;
      // Saved startup state is evidence of an interrupted owner, not an active process.
      return {...candidate, record: {...record, state: 'failed',
        endLeafId: record.sessionFile ? this.files.get(resolve(record.sessionFile))?.leafId : record.endLeafId,
        error: record.sessionFile ? 'Execution is no longer owned by this Pi process; the saved transcript is available'
          : 'Execution is no longer owned by this Pi process; no transcript was saved'}};
    });
  }
  private entries(entries: readonly SessionEntry[], source: string): SavedFile {
    const file: SavedFile = {stamp: '', records: [], sessions: [], workflows: []};
    for (const entry of entries) if (entry.type === 'custom') {
      if (entry.customType !== AGENT_ENTRY && entry.customType !== WORKFLOW_ENTRY_TYPE) continue;
      const updatedAt = Date.parse(entry.timestamp);
      if (!Number.isFinite(updatedAt)) throw new ToolError('AGENT_HISTORY', `Invalid suite record timestamp in ${source}`);
      if (entry.customType === AGENT_ENTRY) {
        const record = decodeAgentRecord(entry.data, source);
        file.records.push({record, updatedAt});
        if (record.sessionFile) file.sessions.push({path: record.sessionFile, cwd: recordWorkspace(record)});
      } else if (entry.customType === WORKFLOW_ENTRY_TYPE) {
        const data = decodeWorkflowEntry(entry.data);
        file.records.push(...data.children.map(record => ({record, updatedAt})));
        file.workflows.push({path: data.recordPath, cwd: data.cwd});
        file.sessions.push(...data.children.flatMap(record => record.sessionFile ? [{path: record.sessionFile, cwd: recordWorkspace(record)}] : []));
      }
    }
    return file;
  }
}
