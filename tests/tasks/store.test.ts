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
  const script = `import { TaskStore } from ${JSON.stringify(storeUrl)}; const store = new TaskStore(process.argv[1]); for(let i=0;i<10;i++)await store.edit([{op:'add',title:process.pid+'-'+i,children:['child']}]);`;
  try {
    await Promise.all(Array.from({ length: 2 }, () => promisify(execFile)(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script, path])));
    const data = await store.snapshot(); validateHierarchy(data);
    assert.equal(data.nextId, 41); assert.equal(new Set(data.tasks.map(task => task.id)).size, 40);
    const lock = `${path}.lock`; writeFileSync(lock, `${process.pid}:holder`);
    let timerRan = false;
    const timer = setTimeout(() => { timerRan = true; unlinkSync(lock); }, 30);
    await store.edit([{ op: 'add', title: 'after lock' }]); clearTimeout(timer);
    assert.equal(timerRan, true, 'the blocked writer yields so its lock holder can release');
    writeFileSync(lock, '0:stale');
    await new TaskStore(path).edit([{ op: 'add', title: 'after stale lock' }]);
    assert.equal((await store.snapshot()).nextId, 43); assert.equal(existsSync(lock), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid files and aborted edits never overwrite valid cached data or partially commit a batch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-suite-tasks-data-')), path = join(root, 'tasks.json'), store = new TaskStore(path);
  try {
    await store.edit([{ op: 'add', title: 'keep', children: ['child'] }]);
    const good = readFileSync(path, 'utf8'), data = await store.snapshot();
    const abort = new AbortController(); abort.abort(new Error('cancelled'));
    await assert.rejects(store.edit([{ op: 'add', title: 'not committed' }], abort.signal), /cancelled/);
    assert.equal(readFileSync(path, 'utf8'), good);
    await assert.rejects(store.edit([{ op: 'update', id: '2', status: 'done' }, { op: 'update', id: '1', status: 'done' }]), /changes\[1\]/);
    assert.equal(readFileSync(path, 'utf8'), good);
    for (const broken of ['{', JSON.stringify({ version: 1, tasks: [] }), JSON.stringify({ ...data, nextId: 1 }), JSON.stringify({ ...data, tasks: [...data.tasks, data.tasks[0]] })]) {
      writeFileSync(path, broken);
      await assert.rejects(store.snapshot(), /TASK_STORE_INVALID/);
      await assert.rejects(store.edit([{ op: 'add', title: 'not committed' }]), /TASK_STORE_INVALID/);
      assert.deepEqual(store.current, data); assert.equal(readFileSync(path, 'utf8'), broken);
    }
    writeFileSync(path, good);
    await Promise.all([store.edit([{ op: 'update', id: '2', status: 'done' }]), store.snapshot(), store.edit([{ op: 'add', title: 'survives snapshot' }])]);
    assert.equal((await store.snapshot()).tasks.length, 3);
    assert.equal((await store.snapshot()).tasks[1].status, 'done');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
