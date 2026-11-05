import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { host } from '../support/host.ts';
import { agentDir, manager, testShell } from '../support/jobs.ts';
import { acquireRuntime } from '../../src/jobs/runtime.ts';
import { JobStore } from '../../src/jobs/store.ts';
import { JobsModule } from '../../src/jobs/index.ts';
import { jobActions } from '../../src/jobs/viewer.ts';
import { SessionBinding } from '../../src/runtime/binding.ts';
import { Notifications } from '../../src/runtime/notifications.ts';
import { Dock } from '../../src/ui/dock.ts';
import { StatusPublisher } from '../../src/ui/status.ts';
import { loadConfig } from '../../src/runtime/config.ts';

test('history clear joins saved logs, rejects occupied records and keeps late consumption from recreating deleted files', { timeout: 15000 }, async () => {
  const root = agentDir(), binding = new SessionBinding(), dock = new Dock(), status = new StatusPublisher(dock);
  let ctx!: ExtensionContext, view!: JobsModule, notifications!: Notifications;
  const h = await host({root, extend: pi => {
    notifications = new Notifications(pi, binding); view = new JobsModule(pi, binding, notifications, status);
    pi.on('session_start', (_event, context) => { ctx = context; binding.bind(ctx); });
  }});
  const runtime = acquireRuntime(root); assert.equal(runtime.mode, 'active');
  if (runtime.mode !== 'active') throw new Error('jobs unavailable');
  const jobs = runtime.manager, store = new JobStore(root), other = manager(root);
  const owner = {ownerSessionId: 'foreign-owner', anchorEntryId: null, cwd: root};
  const sessionManager = new Proxy(ctx.sessionManager, {get(target, key) {
    if (key === 'getSessionId') return () => owner.ownerSessionId;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  binding.bind({...ctx, sessionManager});
  const releaseNotices = notifications.hold();
  const save = JobStore.prototype.save, remove = JobStore.prototype.remove;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), removed = Promise.withResolvers<void>();
  const lateSaves: Promise<void>[] = [];
  try {
    view.bind();
    const active = await jobs.start({...owner, command: 'read line'}, testShell());
    await assert.rejects(jobs.clear(active.id, active.workspace), /JOB_OCCUPIED/);
    await jobs.stop(active.id);
    const ended = await jobs.start({...owner, command: 'read line; echo saved-output'}, testShell());
    jobs.write(ended.id, 'input\n', {source: 'model', kind: 'text', text: 'input'}); await jobs.wait(ended.id);
    assert.match(readFileSync(store.logPath(ended, 'input'), 'utf8'), /input/);
    assert.match(readFileSync(store.logPath(ended, 'stdout'), 'utf8'), /saved-output/);
    const saved = await store.load(ended.workspace, ended.id);
    await store.save({...saved, cleanup: {...saved.cleanup, state: 'unconfirmed'}});
    await assert.rejects(jobs.clear(ended.id, ended.workspace), /JOB_OCCUPIED/, 'disk state is rechecked after the owned snapshot');
    assert.ok(existsSync(store.directory(ended))); await store.save(saved);

    // Hold removal after queue draining, then deliver a notice while deletion owns the path.
    JobStore.prototype.remove = async function (job) {
      if (job.id === ended.id) { entered.resolve(); await release.promise; }
      await remove.call(this, job); if (job.id === ended.id) removed.resolve();
    };
    JobStore.prototype.save = function (job) {
      if (job.id !== ended.id) return save.call(this, job);
      const work = removed.promise.then(() => save.call(this, job)); lateSaves.push(work); return work;
    };
    jobs.quietWakes.add(ended.id);
    const clearing = jobs.clear(ended.id, ended.workspace); await entered.promise;
    assert.equal(jobs.hasOccupancy(), true);
    assert.equal(notifications.has(owner.ownerSessionId, `job:${ended.id}`), true);
    jobs.markNotified(ended.id);
    await assert.rejects(jobs.clear(ended.id, ended.workspace), /JOB_OCCUPIED/);
    release.resolve(); await clearing; await Promise.all(lateSaves);
    assert.equal(lateSaves.length, 0); assert.equal(existsSync(store.directory(ended)), false);
    assert.equal(notifications.has(owner.ownerSessionId, `job:${ended.id}`), false);
    assert.equal(jobs.quietWakes.has(ended.id), false);
    assert.throws(() => jobs.peek(ended.id), /HISTORY_READ_ONLY/);
    JobStore.prototype.save = save; JobStore.prototype.remove = remove;

    const historical = await other.start({...owner, command: 'echo history-only', closeInput: true}, testShell());
    await other.wait(historical.id); await other.shutdown(Date.now() + 5000);
    assert.equal((await jobs.get(historical.id, historical.workspace)).live, false);
    const deps = {jobs: view, dock, notifications, keys: () => loadConfig(root, root).jobs};
    let confirmations = 0;
    const menuCtx = {...ctx, ui: {...ctx.ui,
      select: async (_title: string, choices: string[]) => { assert.ok(choices.includes('Clear history')); return 'Clear history'; },
      confirm: async (title: string) => {
        assert.equal(title, 'Delete history and logs?'); assert.ok(existsSync(store.directory(historical)));
        return ++confirmations === 2;
      },
    }} as ExtensionContext;
    await jobActions({} as never, menuCtx, deps, historical.id);
    assert.equal(confirmations, 2); assert.equal(existsSync(store.directory(historical)), false);
    const readOnlyCtx = {...ctx, ui: {...ctx.ui, select: async (_title: string, choices: string[]) => {
      assert.ok(!choices.includes('Clear history')); return 'Back';
    }}} as ExtensionContext;
    const running = await jobs.start({...owner, command: 'read line'}, testShell());
    await jobActions({} as never, readOnlyCtx, deps, running.id);
    assert.ok(existsSync(join(store.directory(running), 'job.json')));
  } finally {
    release.resolve(); removed.resolve(); JobStore.prototype.save = save; JobStore.prototype.remove = remove;
    view.detach(); releaseNotices();
    await other.shutdown(Date.now() + 5000); await h.dispose(); rmSync(root, {recursive: true, force: true});
  }
});
