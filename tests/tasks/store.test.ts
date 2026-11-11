import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskStore } from '../../src/tasks/store.ts';
import { validateHierarchy } from '../../src/tasks/model.ts';

test('real concurrent processes reread under file locks; lock retries yield the event loop and stale locks recover', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-lock-')), path = join(root, 'tasks.json');
  const store = new TaskStore(path), storeUrl = new URL('../../src/tasks/store.ts', import.meta.url).href;
  const script = `import { TaskStore } from ${JSON.stringify(storeUrl)}; const store = new TaskStore(process.argv[1]); for(let i=0;i<10;i++)await store.edit([{op:'add',title:process.pid+'-'+i,children:['child']}], store.current.generation);`;
  try {
    // The reader races both writers; Windows read handles must not break atomic replacement.
    const reader = `import assert from 'node:assert/strict'; import { TaskStore } from ${JSON.stringify(storeUrl)}; const store = new TaskStore(process.argv[1]); let count=0; for(let i=0;i<60;i++){const data=await store.snapshot(); assert.ok(data.tasks.length>=count); assert.equal(data.nextId,data.tasks.filter(task=>!task.parentId).length+1); count=data.tasks.length;}`;
    await Promise.all([reader, script, script].map(source => promisify(execFile)(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', source, path])));
    const data = await store.snapshot(); validateHierarchy(data);
    assert.equal(data.nextId, 21); assert.equal(new Set(data.tasks.map(task => task.id)).size, 40);
    const lock = `${path}.lock`; writeFileSync(lock, `${process.pid}:holder`);
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; unlinkSync(lock); }, 30);
    await store.edit([{ op: 'add', title: 'after lock' }], store.current.generation); clearTimeout(timer);
    assert.equal(timerRan, true, 'the blocked writer yields so its lock holder can release');
    writeFileSync(lock, '0:stale');
    const fresh = new TaskStore(path); await fresh.edit([{ op: 'add', title: 'after stale lock' }], fresh.current.generation);
    assert.equal((await store.snapshot()).nextId, 23); assert.equal(existsSync(lock), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid files and aborted edits never overwrite valid cached data or partially commit a batch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-data-')), path = join(root, 'nested', 'tasks.json'), store = new TaskStore(path);
  try {
    const initial = await store.snapshot();
    assert.deepEqual(initial, {version: 4, generation: initial.generation, nextId: 1, tasks: []});
    assert.equal(existsSync(join(root, 'nested')), false, 'reading an unused store creates no directory or lock');
    await store.edit([{ op: 'add', title: 'keep', children: ['child'] }], store.current.generation);
    const good = readFileSync(path, 'utf8'), data = await store.snapshot();
    const abort = new AbortController(); abort.abort(new Error('cancelled'));
    await assert.rejects(store.edit([{ op: 'add', title: 'not committed' }], store.current.generation, abort.signal), /cancelled/);
    assert.equal(readFileSync(path, 'utf8'), good);
    await assert.rejects(store.edit([{ op: 'update', id: '1.1', status: 'done' }, { op: 'update', id: '1', status: 'done' }], store.current.generation), /changes\[1\]/);
    assert.equal(readFileSync(path, 'utf8'), good);
    for (const broken of ['{', JSON.stringify({ version: 1, tasks: [] }), JSON.stringify({ ...data, nextId: 1 }), JSON.stringify({ ...data, tasks: [...data.tasks, data.tasks[0]] })]) {
      writeFileSync(path, broken);
      await assert.rejects(store.snapshot(), /TASK_STORE_INVALID/);
      await assert.rejects(store.edit([{ op: 'add', title: 'not committed' }], store.current.generation), /TASK_STORE_INVALID/);
      assert.deepEqual(store.current, data); assert.equal(readFileSync(path, 'utf8'), broken);
    }
    writeFileSync(path, good);
    // Completing the only child would clear the list; progress writes keep it for comparison.
    await Promise.all([store.edit([{ op: 'update', id: '1.1', status: 'doing' }], store.current.generation), store.snapshot(), store.edit([{ op: 'add', title: 'survives snapshot' }], store.current.generation)]);
    assert.equal((await store.snapshot()).tasks.length, 3);
    assert.equal((await store.snapshot()).tasks[1].status, 'doing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('shared JSON subscriptions observe external atomic writes and report invalid files without polling or corrupting cache', {timeout: 8000}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-watch-')), path = join(root, 'nested', 'tasks.json'), store = new TaskStore(path);
  let changed = Promise.withResolvers<void>(), failed = Promise.withResolvers<unknown>();
  const off = store.subscribe(() => changed.resolve(), error => failed.resolve(error));
  const timeout = setTimeout(() => { changed.reject(new Error('External commit was not observed')); failed.reject(new Error('External invalid data was not reported')); }, 5000);
  try {
    const writer = new TaskStore(path);
    await writer.edit([{op: 'add', title: 'external group', children: ['execution', 'pending']}], writer.current.generation);
    await changed.promise;
    assert.equal(store.current.tasks.length, 3, 'UI current state changes without explicitly reading a snapshot');
    changed = Promise.withResolvers<void>();
    await writer.edit([{op: 'done', id: '1.1'}], writer.current.generation); await changed.promise;
    assert.equal(store.current.tasks[1].status, 'done');
    const good = structuredClone(store.current);
    writeFileSync(path, '{invalid');
    assert.match(String(await failed.promise), /TASK_STORE_INVALID/);
    assert.deepEqual(store.current, good);
  } finally { off(); clearTimeout(timeout); rmSync(root, {recursive: true, force: true}); }
});

test('clear and all-complete rotate generations atomically; queued writers and links cannot hit reused IDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-reset-')), path = join(root, 'tasks.json');
  const store = new TaskStore(path);
  try {
    await store.edit([{op: 'add', title: 'work', children: ['first', 'second']}], store.current.generation);
    const source = store.current.generation;
    await store.link('1.1', {agentId: 'agent_old', jobId: 'job_old'}, source);
    const cleared = store.clear(source);
    const staleEdit = assert.rejects(store.edit([{op: 'add', title: 'queued old work'}], source), {code: 'TASK_STALE'});
    const staleLink = assert.rejects(store.link('1.1', {jobId: 'job_late'}, source), {code: 'TASK_STALE'});
    const receipt = await cleared; await Promise.all([staleEdit, staleLink]);
    assert.equal(receipt.cleared, 'clear'); assert.notEqual(receipt.generation, source);
    assert.deepEqual(store.current.tasks, []); assert.equal(store.current.nextId, 1);
    await store.edit([{op: 'add', title: 'replacement', children: ['new first']}], receipt.generation);
    assert.deepEqual((await store.snapshot()).tasks.map(task => task.id), ['1', '1.1']);
    await assert.rejects(store.snapshot(source), {code: 'TASK_STALE'});
    const completed = await store.edit([{op: 'done', id: '1.1'}], receipt.generation);
    assert.equal(completed.cleared, 'completed'); assert.notEqual(completed.generation, receipt.generation);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), store.current);
    assert.ok(!readFileSync(path, 'utf8').includes('replacement'), 'no task history is persisted');
    // Neither empty groups nor empty lists are all-complete; explicit clear still rotates.
    await store.edit([{op: 'add', title: 'empty group'}], completed.generation);
    assert.equal(store.current.tasks.length, 1); assert.equal(store.current.generation, completed.generation);
    await store.clear(completed.generation); const emptyGeneration = store.current.generation;
    await store.clear(emptyGeneration); assert.notEqual(store.current.generation, emptyGeneration);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('version 2 migrates child ordinals and dependency edges in memory, then publishes version 4 on edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-task-migration-')), path = join(root, 'tasks.json');
  const task = (id: string, createdAt: number, parentId?: string, blockedBy: string[] = []) => ({ id, title: `task ${id}`,
    createdAt, updatedAt: createdAt, blockedBy, jobIds: [], ...parentId ? { parentId, status: 'todo' } : {} });
  const legacy = { version: 2, nextId: 10, tasks: [task('1', 0), task('3', 2, '1', ['7']), task('2', 2, '1'),
    task('6', 0, undefined, ['3']), task('7', 1, '6', ['2', '1'])] };
  try {
    writeFileSync(path, JSON.stringify(legacy));
    const store = new TaskStore(path), data = await store.snapshot();
    assert.equal(data.version, 4); assert.equal(data.nextId, 10);
    assert.deepEqual(data.tasks.map(task => task.id), ['1', '1.1', '1.2', '6', '6.1']);
    assert.deepEqual(data.tasks.map(task => task.blockedBy), [[], [], ['6.1'], ['1.2'], ['1.1', '1']]);
    assert.deepEqual(data.tasks.filter(task => !task.parentId).map(task => task.nextChild), [3, 2]);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), legacy, 'reading does not rewrite history');
    await store.edit([{op: 'delete', id: '1.1'}, {op: 'add', parentId: '1', title: 'next'}, {op: 'add', title: 'group'}], store.current.generation);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.version, 4); assert.ok(saved.tasks.some((task: {id: string}) => task.id === '1.3'));
    assert.ok(saved.tasks.some((task: {id: string}) => task.id === '10')); validateHierarchy(saved);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
