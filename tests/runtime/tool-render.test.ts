import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Theme, ToolRenderers } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { toolRenderers } from '../../src/ui/tool-render.ts';
import * as agents from '../../src/agents/render.ts';
import { agentDisplayName, agentRuntime } from '../../src/agents/runtime.ts';
import { agentSummary, summaryLine } from '../../src/agents/index.ts';
import type { AgentRecord } from '../../src/agents/types.ts';
import { waitRenderers } from '../../src/runtime/wait-render.ts';
import { agentDir } from '../support/jobs.ts';

test('shared tool shell merges progress/results, pads one-line summaries and retains full expanded/error output', () => {
  const theme = { fg: (_tone: string, text: string) => `\x1b[31m${text}\x1b[39m` } as Theme;
  const renderer = toolRenderers<unknown, { summary: string }>({
    call: () => ({ icon: '⟳', tone: 'accent', title: 'Call' }),
    collapsed: data => ({ icon: '✔', tone: 'success', title: 'Result\nheading', summary: data.summary, meta: ['meta\nline'] }),
  });
  const ctx = { state: {}, args: {}, isError: false, outputPad: 2 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
  const call = renderer.renderCall!({}, theme, ctx);
  assert.equal(call.render(40).length, 1);
  const body = Array.from({length: 20}, (_, i) => `body ${i}`).join('\n');
  const result = { content: [{type: 'text' as const, text: body}], details: { summary: 'a\nb'.repeat(100) } };
  for (const isPartial of [true, false]) {
    const component = renderer.renderResult!(result, { expanded: false, isPartial }, theme, ctx);
    assert.deepEqual(call.render(40), []);
    for (const width of [40, 60, 120]) {
      const lines = component.render(width);
      assert.equal(lines.length, 1); assert.ok(visibleWidth(lines[0]) <= width);
      assert.ok(lines[0].startsWith('  '));
    }
  }
  assert.match(renderer.renderResult!(result, {expanded: true, isPartial: false}, theme, ctx).render(40).join('\n'), /body 19/);
  ctx.isError = true;
  const error = renderer.renderResult!(result, {expanded: false, isPartial: false}, theme, ctx).render(40).join('\n');
  assert.match(error, /✘/); assert.match(error, /body 19/);
});

test('named agent tools and wait render names without changing model IDs or initializing a runtime for missing history', async () => {
  const root = agentDir(), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'absent');
  const id = 'agent_00000001';
  assert.equal(agentDisplayName(id), id);
  assert.equal(existsSync(process.env.PI_CODING_AGENT_DIR), false, 'display lookup does not acquire a disk-backed owner');
  process.env.PI_CODING_AGENT_DIR = root;
  const manager = agentRuntime();
  const record: AgentRecord = { version: 1, id, runId: 'run_00000001', name: 'Review', type: 'general-purpose', prompt: 'Inspect code',
    state: 'completed', elapsedMs: 1200, background: false, persisted: false, cwd: root, ownerSessionId: 'owner', anchorEntryId: null,
    ancestors: [], createdAt: new Date().toISOString(), model: 'offline/model', modelSource: 'inherited', thinking: 'off', thinkingSource: 'inherited' };
  manager.restore([record, { ...record, id: 'agent_00000002', runId: 'run_00000002', name: 'Other' }]);
  const theme = { fg: (_tone: string, text: string) => text } as Theme, agent = agentSummary(record);
  const body = summaryLine(record), content = [{ type: 'text' as const, text: body }];
  const rows: [ToolRenderers, object, object, RegExp][] = [
    [agents.startRenderers, { name: record.name, prompt: record.prompt, background: false }, { agent }, /✔ Review · 1\.2s/],
    [agents.listRenderers, { agentId: id, state: 'all' }, { agents: [agent] }, /Agents · 1 all \(session\)/],
    [agents.getRenderers, { id }, { agent }, /✔ Review · completed/],
    [agents.readRenderers, { id }, { agent, stream: 'result', offset: 0, nextOffset: 100, totalBytes: 100 }, /Review · read · result 0–100 \/ 100 B/],
    [agents.sendRenderers, { id, message: 'Continue' }, { agent, action: 'steered' }, /Review · steered/],
    [agents.stopRenderers, { id }, { name: record.name, state: 'stopped', cleanup: 'confirmed', affected: [{ id }] }, /⊘ Review · stopped · cleanup confirmed/],
  ];
  try {
    for (const [renderer, args, details, expected] of rows) {
      const ctx = { state: {}, args, isError: false, outputPad: 0 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
      assert.match(renderer.renderCall!(args, theme, ctx).render(120).join('\n'), /Review/);
      const result = { content, details }, before = JSON.stringify(result);
      const collapsed = renderer.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx).render(120).join('\n');
      assert.match(collapsed, expected); assert.doesNotMatch(collapsed, /agent_|run_/);
      const expanded = renderer.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx).render(120).join('\n');
      assert.match(expanded.split('\n')[0], /Review/); assert.match(expanded, /agent_00000001/);
      assert.equal(JSON.stringify(result), before); assert.ok(result.content[0].text.startsWith(id));
    }
    const args = { ids: [id] }, summary = `${id} running · Review · ${record.runId}\nread: agent_read({"id":"${id}"})`;
    const result = { content: [{ type: 'text' as const, text: `wait 0/1 settled\n${summary}\nalso:\nAgent result: agent_00000002 completed\njob_00000002 completed\nwf_000000000003 completed\npending: ${id}` }],
      details: { results: [{ id, runId: record.runId, state: 'running', settled: false, summary }],
        others: [{ id: 'agent_00000002', runId: 'run_00000002', state: 'completed', settled: true, summary: 'Agent result: agent_00000002 completed' },
          { id: 'job_00000002', state: 'completed', settled: true, summary: 'job_00000002 completed' },
          { id: 'wf_000000000003', state: 'completed', settled: true, summary: 'wf_000000000003 completed' }],
        pending: [id], timedOut: true, reason: 'timeout' as const } };
    const ctx = { state: {}, args, isError: false, outputPad: 0 } as Parameters<NonNullable<ToolRenderers['renderResult']>>[3];
    const before = JSON.stringify(result);
    assert.match(waitRenderers.renderResult!(result, { expanded: false, isPartial: false }, theme, ctx).render(120).join('\n'), /Wait · 0\/1 settled · returned early: timeout/);
    const expanded = waitRenderers.renderResult!(result, { expanded: true, isPartial: false }, theme, ctx).render(120).join('\n');
    assert.match(expanded, /\nReview running/); assert.match(expanded, /pending: Review/);
    assert.match(expanded, /Agent result: Other completed/);
    assert.match(expanded, /read: agent_read\({"id":"agent_00000001"}\)/);
    assert.match(expanded, /job_00000002 completed\s+wf_000000000003 completed/);
    assert.equal(JSON.stringify(result), before);
  } finally {
    await manager.shutdown(); rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
