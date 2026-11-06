import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir } from '../support/jobs.ts';
import { agentRuntime } from '../../src/agents/runtime.ts';
import { loadConfig } from '../../src/runtime/config.ts';
import { agentTypes, resolveType } from '../../src/agents/catalog.ts';
import { packageResources } from '../../src/agents/resources/packages.ts';
import { transcript, transcriptText } from '../../src/agents/records.ts';

function file(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function type(root: string, name: string, fields: Record<string, unknown>, project = false): void {
  file(join(root, ...project ? ['.pi', 'agents'] : ['agents'], `${name}.md`), `---\n${Object.entries({ name, ...fields }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\nHandle this task.`);
}
async function setup() {
  const root = agentDir(); let ctx!: ExtensionContext;
  const h = await host({ root, tools: ['read'], extend: pi => { pi.on('session_start', (_event, context) => { ctx = context; }); } });
  return { ...h, root, ctx, manager: agentRuntime(), config: loadConfig(root, root),
    async cleanup() { await h.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test('declared package resources follow Pi configured roots, exclusions, gates, local overrides and trust', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    const pkg = join(h.root, 'package'), projectPkg = join(h.root, 'project-package');
    file(join(pkg, 'package.json'), JSON.stringify({ name: '@suite/reviews', pi: { subagents: { agents: ['./agents', '!./agents/skip.md'], workflows: ['./flows/one.js'] } }, 'pi-subagents': ['./wrong'] }));
    file(join(pkg, 'agents', 'review.md'), '---\nname: review\n---\nPackage review.');
    file(join(pkg, 'agents', 'skip.md'), '---\nname: skip\n---\nExcluded.');
    file(join(pkg, 'flows', 'one.js'), 'export default () => 1;'); file(join(pkg, 'flows', 'other.js'), 'export default () => 2;');
    file(join(projectPkg, 'package.json'), JSON.stringify({ name: 'project-package', 'pi-subagents': ['./agents'] }));
    file(join(projectPkg, 'agents', 'project-review.md'), '---\nname: project-review\n---\nProject package.');
    file(join(h.root, 'settings.json'), JSON.stringify({ packages: [pkg] }));
    file(join(h.root, '.pi', 'settings.json'), JSON.stringify({ packages: [projectPkg] }));
    assert.deepEqual(packageResources(h.root, 'agents', false).map(resource => resource.packageName), ['@suite/reviews']);
    assert.equal(packageResources(h.root, 'agents', true).length, 2);
    assert.equal(packageResources(h.root, 'agents', true, ['REVIEWS']).length, 1);
    assert.equal(packageResources(h.root, 'agents', true, false).length, 0);
    assert.deepEqual(packageResources(h.root, 'workflows', true).map(resource => resource.path), [join(pkg, 'flows', 'one.js')]);
    assert.equal(resolveType(h.root, 'review').packageName, '@suite/reviews');
    type(h.root, 'review', { description: 'user' }); type(h.root, 'review', { description: 'project', enabled: false }, true);
    assert.equal(resolveType(h.root, 'review').description, 'user');
    assert.throws(() => resolveType(h.root, 'review', { trusted: true }), /disabled/);
    assert.ok(!agentTypes(h.root, h.root, { trusted: false }).some(agent => agent.name === 'project-review'));
    file(join(pkg, 'package.json'), JSON.stringify({ pi: { subagents: ['./agents', '../outside.md'] } }));
    assert.throws(() => packageResources(h.root, 'agents', false), /outside install root/);
    file(join(pkg, 'package.json'), JSON.stringify({ pi: { subagents: ['./agents'] } }));
    // A directory junction needs no Windows symlink privilege; Linux ignores the type.
    mkdirSync(join(h.root, 'outside')); symlinkSync(join(h.root, 'outside'), join(pkg, 'agents', 'escape.md'), 'junction');
    assert.throws(() => packageResources(h.root, 'agents', false), /escapes install root/);
  } finally { await h.cleanup(); }
});

test('real MCP stdio discovery keeps explicit resources beside a namespace filter and closes child transports', { timeout: 15000 }, async () => {
  const h = await setup(), trace = join(h.root, 'mcp.jsonl');
  try {
    const server = fileURLToPath(new URL('../support/mcp-server.ts', import.meta.url));
    const endpoint = (name: string) => ({command: process.execPath, args: ['--experimental-transform-types', server, name, trace], exposure: 'direct', timeout: 3});
    file(join(h.root, 'mcp.json'), JSON.stringify({mcpServers: {docs: endpoint('docs'), other: endpoint('other')}}));
    const lastText = (context: {messages: {role: string; content?: unknown}[]}) => JSON.stringify(context.messages.findLast(message => message.role === 'toolResult')?.content);
    const allowed = () => fauxAssistantMessage(fauxToolCall('mcp__docs__allowed', {}));
    const resource = () => fauxAssistantMessage(fauxToolCall('read_mcp_resource', {server: 'docs', uri: 'fixture://docs/one'}));
    type(h.root, 'wire', {extensions: ['mcp'], skills: false, tools: ['mcp__docs', 'list_mcp_resources', 'read_mcp_resource'], disallowed_tools: ['mcp__docs__denied']});
    h.faux.setResponses([
      allowed,
      context => { assert.match(lastText(context), /docs:allowed/); return fauxAssistantMessage(fauxToolCall('list_mcp_resources', {server: 'docs'})); },
      context => { assert.match(lastText(context), /fixture:\/\/docs\/one/); return resource(); },
      context => { assert.match(lastText(context), /docs:resource/); return fauxAssistantMessage(fauxToolCall('mcp__other__allowed', {})); },
      context => { assert.match(lastText(context), /not available|not found/); return fauxAssistantMessage(fauxToolCall('mcp__docs__denied', {})); },
      context => { assert.match(lastText(context), /not available|not found/); return fauxAssistantMessage('resources checked'); },
    ]);
    const mixed = await h.manager.start({type: 'wire', prompt: 'read selected resources', background: false}, {ctx: h.ctx}, h.config);
    assert.equal((await mixed.done.promise).state, 'completed', mixed.record.error);
    for (const [name, tools, disallowed] of [
      ['denied-resource', ['mcp__docs', 'read_mcp_resource'], ['read_mcp_resource']],
      ['namespace-only', ['mcp__docs'], []],
    ] as const) {
      type(h.root, name, {extensions: ['mcp'], skills: false, tools, disallowed_tools: disallowed});
      h.faux.setResponses([resource, context => { assert.match(lastText(context), /not available|not found/); return allowed(); }, fauxAssistantMessage('scope checked')]);
      const run = await h.manager.start({type: name, prompt: 'check resource scope', background: false}, {ctx: h.ctx}, h.config);
      assert.equal((await run.done.promise).state, 'completed', run.record.error);
    }
    const events = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.method === 'resources/read').length, 1);
    assert.ok(!events.some(event => event.method === 'tools/call' && (event.server === 'other' || event.params.name === 'denied')));
    const pids = events.filter(event => event.pid).map(event => event.pid);
    assert.equal(pids.length, 6);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'}, 'completed children close their actual MCP peers');
  } finally { await h.cleanup(); }
});

test('selected extensions retain late tools; direct and nested calls enforce scope despite first-turn widening', { timeout: 15000 }, async () => {
  const h = await setup(), key = `suite-resource:${h.root}`;
  const state = { loads: [] as string[], calls: [] as string[], nested: [] as unknown[] };
  (globalThis as unknown as Record<string, unknown>)[key] = state;
  try {
    const pkg = join(h.root, 'plugin-package');
    file(join(pkg, 'package.json'), JSON.stringify({ name: '@suite/plugin', pi: { extensions: ['./dist/index.ts'] } }));
    file(join(pkg, 'dist', 'index.ts'), `export default function(pi) {
      const state = globalThis[${JSON.stringify(key)}]; state.loads.push('plugin');
      const add = (name, exposure = 'direct', defaultActive = true) => pi.registerTool({ name, label: name, description: name,
        parameters: { type: 'object', properties: {} }, exposure, defaultActive,
        execute: async (_id, _args, _signal, _update, ctx) => {
          state.calls.push(name);
          if (name === 'bridge') state.nested.push(await ctx.executeTool('hidden_denied', {}));
          if (name === 'codemode') {
            state.nested.push(await ctx.executeTool('mcp__docs__allowed', {}));
            state.nested.push(await ctx.executeTool('mcp__other__denied', {}));
          }
          return { content: [{ type: 'text', text: name }], details: {} };
        } });
      add('allowed', 'direct', false); add('denied'); add('hidden_denied', 'codemode'); add('lazy', 'direct', false); add('bridge');
      add('mcp__docs__allowed', 'codemode'); add('mcp__other__denied', 'codemode'); add('codemode');
      pi.on('before_agent_start', () => { add('late'); pi.setActiveTools(pi.getAllTools().map(tool => tool.name)); });
    }`);
    file(join(h.root, '.pi', 'extensions', 'excluded.ts'), `export default () => { globalThis[${JSON.stringify(key)}].loads.push('excluded'); };`);
    file(join(h.root, 'settings.json'), JSON.stringify({ packages: [pkg], extensions: [resolve('src/index.ts')] }));
    type(h.root, 'scoped', { extensions: ['*'], exclude_extensions: ['excluded', 'codemode', 'tool-search', 'mcp'], tools: ['read', 'ext:plugin/allowed', 'ext:plugin/late', 'ext:plugin/bridge'], skills: false });
    h.faux.setResponses([
      fauxAssistantMessage(fauxToolCall('denied', {})), fauxAssistantMessage(fauxToolCall('bridge', {})),
      fauxAssistantMessage(fauxToolCall('late', {})), fauxAssistantMessage(fauxToolCall('allowed', {})),
      () => {
        const run = [...h.manager.runs.values()][0];
        assert.ok(run.session!.getActiveToolNames().includes('allowed'));
        assert.ok(!run.session!.getActiveToolNames().includes('denied')); assert.ok(!run.session!.getActiveToolNames().includes('lazy'));
        assert.equal(run.session!.extensionRunner.getCommand('agents'), undefined, 'the suite is injected only as scoped child tools');
        return fauxAssistantMessage('scope checked');
      },
    ]);
    const run = await h.manager.start({ type: 'scoped', prompt: 'exercise scope', background: false }, { ctx: h.ctx }, h.config);
    const done = await run.done.promise;
    assert.equal(done.state, 'completed', done.error);
    assert.deepEqual(state.loads, ['plugin']); assert.deepEqual(state.calls, ['bridge', 'late', 'allowed']);
    assert.match(JSON.stringify(state.nested), /not available/);
    assert.match(transcriptText(transcript(done, run)), /not available/);
    type(h.root, 'mcp-scoped', { extensions: ['plugin'], tools: ['mcp__docs'], skills: false });
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('codemode', {})), fauxAssistantMessage('MCP scoped')]);
    const mcp = await h.manager.start({ type: 'mcp-scoped', prompt: 'exercise MCP scope', background: false }, { ctx: h.ctx }, h.config);
    assert.equal((await mcp.done.promise).state, 'completed', mcp.record.error);
    assert.ok(state.calls.includes('mcp__docs__allowed')); assert.ok(!state.calls.includes('mcp__other__denied'));
    assert.match(JSON.stringify(state.nested.at(-1)), /not available/);
    type(h.root, 'bad', { extensions: ['missing-plugin'] });
    const bad = await h.manager.start({ type: 'bad', prompt: 'bad config', background: false }, { ctx: h.ctx }, h.config);
    assert.match((await bad.done.promise).error!, /missing-plugin.*not enabled or available/);
  } finally { delete (globalThis as unknown as Record<string, unknown>)[key]; await h.cleanup(); }
});

test('named skills, bounded read-only memory, parent context and per-type execution options reach the SDK once', { timeout: 15000 }, async () => {
  const h = await setup();
  try {
    file(join(h.root, 'parent-tool.txt'), 'TOOL_SECRET');
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('read', { path: 'parent-tool.txt' })), fauxAssistantMessage('PARENT_DECISION')]);
    await h.session.prompt('PARENT_QUESTION');
    file(join(h.root, 'skills', 'focus', 'SKILL.md'), '---\nname: focus\ndescription: Focus skill\n---\nPRELOADED_CONTENT');
    file(join(h.root, '.pi', 'skills', 'unused', 'SKILL.md'), '---\nname: unused\ndescription: Unused skill\n---\nUNUSED_SKILL');
    file(join(h.root, 'agent-memory', 'reader', 'MEMORY.md'), `${'MEMORY_LINE\n'.repeat(200)}OUTSIDE_MEMORY_LIMIT`);
    file(join(h.root, 'AGENTS.md'), 'PROJECT_CONTEXT_MUST_NOT_REPLACE');
    type(h.root, 'reader', { tools: ['Read'], extensions: false, skills: ['focus'], memory: 'user', inherit_context: true, run_in_background: false, session_dir: './child-sessions' });
    h.faux.setResponses([context => {
      const prompt = JSON.stringify(context.messages.filter(message => message.role === 'system'));
      assert.match(prompt, /Preloaded Skill: focus/); assert.equal(prompt.split('PRELOADED_CONTENT').length, 2);
      assert.match(prompt, /Agent Memory \(read-only\)/); assert.ok(!prompt.includes('OUTSIDE_MEMORY_LIMIT'));
      assert.ok(!prompt.includes('UNUSED_SKILL')); assert.ok(!prompt.includes('PROJECT_CONTEXT_MUST_NOT_REPLACE'));
      const users = JSON.stringify(context.messages.filter(message => message.role === 'user'));
      assert.match(users, /PARENT_QUESTION/); assert.match(users, /PARENT_DECISION/); assert.ok(!users.includes('TOOL_SECRET'));
      const run = [...h.manager.runs.values()][0]; assert.ok(!run.session!.getActiveToolNames().includes('write'));
      return fauxAssistantMessage('context checked');
    }]);
    const run = await h.manager.start({ type: 'reader', prompt: 'read context', background: true, inheritContext: false }, { ctx: h.ctx }, h.config);
    const done = await run.done.promise;
    assert.equal(done.state, 'completed', done.error); assert.equal(done.background, false);
    assert.equal(dirname(done.sessionFile!), join(h.root, 'child-sessions'));
    type(h.root, 'writer', { tools: ['write'], extensions: false, skills: false, memory: 'project' });
    const memory = join(h.root, '.pi', 'agent-memory', 'writer', 'MEMORY.md');
    h.faux.setResponses([fauxAssistantMessage(fauxToolCall('write', { path: memory, content: 'saved memory' })), fauxAssistantMessage('saved')]);
    const writer = await h.manager.start({ type: 'writer', prompt: 'save memory', background: false }, { ctx: h.ctx }, h.config);
    assert.equal((await writer.done.promise).state, 'completed'); assert.equal(readFileSync(memory, 'utf8'), 'saved memory');
  } finally { await h.cleanup(); }
});

test('untrusted and isolated children do not load project code or skills; disabled nesting is not injected', { timeout: 15000 }, async () => {
  const h = await setup(), key = `suite-trust:${h.root}`;
  (globalThis as unknown as Record<string, unknown>)[key] = 0;
  try {
    file(join(h.root, '.pi', 'extensions', 'project.ts'), `export default () => { globalThis[${JSON.stringify(key)}]++; };`);
    file(join(h.root, '.pi', 'skills', 'project', 'SKILL.md'), '---\nname: project\ndescription: Project skill\n---\nPROJECT_SKILL');
    type(h.root, 'project-only', {}, true);
    const untrusted = { ...h.ctx, isProjectTrusted: () => false };
    await assert.rejects(h.manager.start({ type: 'project-only', prompt: 'project type' }, { ctx: untrusted }, h.config), /Unknown/);
    h.faux.setResponses([context => { assert.ok(!JSON.stringify(context.messages).includes('PROJECT_SKILL')); return fauxAssistantMessage('untrusted'); }]);
    const run = await h.manager.start({ prompt: 'untrusted', background: false }, { ctx: untrusted }, h.config);
    assert.equal((await run.done.promise).state, 'completed', run.record.error);
    type(h.root, 'isolated', { isolated: true, extensions: ['*'], skills: ['project'], allowed_subagents: 'all', prompt_mode: 'append' });
    // Pi renders the cwd section with forward slashes on every platform.
    const parent = { ...h.ctx, getSystemPrompt: () => `PARENT_PREFIX\n\n<skills>\nPARENT_SKILL\n</skills>\n\n<cwd>\n${h.root.replace(/\\/g, '/')}\n</cwd>\nPARENT_EXTENSION` };
    h.faux.setResponses([async context => {
      const messages = JSON.stringify(context.messages); assert.match(messages, /PARENT_PREFIX/);
      for (const forbidden of ['PARENT_SKILL', 'PROJECT_SKILL', 'PARENT_EXTENSION']) assert.ok(!messages.includes(forbidden));
      const child = [...h.manager.runs.values()].find(item => item.record.type === 'isolated')!;
      assert.ok(!child.session!.getAllTools().some(tool => tool.name === 'agent_start'));
      await assert.rejects(h.manager.start({ prompt: 'nested bypass' }, { ctx: h.ctx, run: child }, h.config), /isolated child/);
      return fauxAssistantMessage('isolated');
    }]);
    const isolated = await h.manager.start({ type: 'isolated', prompt: 'isolated', background: false, isolated: false }, { ctx: parent }, h.config);
    assert.equal((await isolated.done.promise).state, 'completed', isolated.record.error);
    assert.equal((globalThis as unknown as Record<string, unknown>)[key], 0);
    type(h.root, 'reader-only', { memory: 'local', tools: ['read'], extensions: false, skills: false });
    h.faux.setResponses([fauxAssistantMessage('no memory yet')]);
    const reader = await h.manager.start({ type: 'reader-only', prompt: 'read memory', background: false }, { ctx: h.ctx }, h.config);
    assert.equal((await reader.done.promise).state, 'completed');
    assert.equal(existsSync(join(h.root, '.pi', 'agent-memory-local', 'reader-only')), false);
  } finally { await h.cleanup(); delete (globalThis as unknown as Record<string, unknown>)[key]; }
});
