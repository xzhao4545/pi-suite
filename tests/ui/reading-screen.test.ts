import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, VStack, TuiAltScreen, getKeybindings, type OverlayHandle } from '@earendil-works/pi-tui';
import { withReadingSession, withReadingScreen, openReading, readingRows, isReadingScreen, isReadingSession } from '../../src/ui/reading.ts';
import { DetailsView } from '../../src/ui/details.ts';
import { BrowserView, browseState } from '../../src/ui/browser.ts';
import { selectValue } from '../../src/ui/select.ts';
import { readerTerminal, regularReaderTerminal } from '../support/reader.ts';
import { host } from '../support/host.ts';

test('full-screen reading covers the live main footer in both native modes, including short pickers and resize, then restores it without replacing instances', async () => {
  let context!: ExtensionContext;
  const h = await host({extend: pi => pi.on('session_start', (_event, ctx) => {context = ctx;})});
  try {
    for (const create of [readerTerminal, regularReaderTerminal]) {
      const native = create(), tui = native.tui;
      let revision = 0, ready = Promise.withResolvers<OverlayHandle>();
      const footer = {render: () => [`MAIN FOOTER ${revision}`], invalidate() {}};
      const body = new Text('main history\n'.repeat(70), 0, 0);
      const base = new VStack(); base.addChild(body, {grow: 1, minSize: 0}); base.addChild(footer, {basis: 1, shrink: 0});
      if (tui instanceof TuiAltScreen) tui.setLayoutRoot(base); else tui.addChild(base);
      tui.setFocus(body); tui.renderNow();
      assert.match((await native.lines()).join('\n'), /MAIN FOOTER 0/);
      const ctx: ExtensionContext = {...context, ui: {...context.ui, custom: async (factory, options) => new Promise((resolve, reject) => {
        let handle: OverlayHandle | undefined, dispose: (() => void) | undefined, closed = false;
        Promise.resolve().then(() => factory(tui, context.ui.theme, getKeybindings() as never, value => {
          closed = true; handle?.hide(); dispose?.(); resolve(value);
        })).then(component => {
          if (closed) return;
          dispose = component.dispose?.bind(component);
          handle = tui.showOverlay(component, typeof options?.overlayOptions === 'function' ? options.overlayOptions() : options?.overlayOptions);
          options?.onHandle?.(handle);
          ready.resolve(handle); tui.renderNow();
        }).catch(reject);
      })}};
      try {
        await withReadingScreen(ctx, async () => {
          const reader = openReading<void>(ctx, (screen, _theme, _keys, done) =>
            new DetailsView(screen, () => 'Subagent', new Text('CHILD CONTENT', 0, 0), () => done()));
          const handle = await ready.promise;
          for (const [rows, columns] of [[24, 40], [30, 80], [40, 120]]) {
            native.resize(rows, columns);
            assert.deepEqual(handle.getBounds(), {row: 0, col: 0, width: columns, height: rows});
            const lines = await native.lines();
            assert.match(lines.join('\n'), /CHILD CONTENT/); assert.doesNotMatch(lines.join('\n'), /MAIN FOOTER/);
            assert.equal(readingRows(tui), rows); assert.equal(tui.mode, create === readerTerminal ? 'fullscreen' : 'regular');
          }
          revision = 1; tui.requestRender(); native.send('\x1b'); await reader;
          assert.doesNotMatch((await native.lines()).join('\n'), /MAIN FOOTER/, 'child-page loading cannot expose the main footer');
          assert.notStrictEqual((tui as unknown as {getFocusedComponent(): unknown}).getFocusedComponent(), body, 'hidden main editor cannot receive input between pages');
          // The reading chain retains the full-screen policy for model/thinking child pages.
          ready = Promise.withResolvers();
          const picker = selectValue(ctx, 'Model', [{value: 'one', label: 'One model'}], 'one');
          const pickerHandle = await ready.promise;
          assert.equal(pickerHandle.getBounds()?.height, 40);
          assert.doesNotMatch((await native.lines()).join('\n'), /MAIN FOOTER/);
          native.send('\x1b'); await picker;
        });
        assert.equal(isReadingScreen(ctx), false);
        tui.renderNow(); assert.match((await native.lines()).join('\n'), /MAIN FOOTER 1/);
        assert.strictEqual(base.children.at(-1), footer);
        assert.strictEqual((tui as unknown as {getFocusedComponent(): unknown}).getFocusedComponent(), body);
        if (tui.mode === 'regular') assert.equal(readingRows(tui), 28, 'ordinary readers retain their original 70% budget');
        await assert.rejects(withReadingScreen(ctx, () => openReading(ctx, () => {throw new Error('factory failure');})), /factory failure/);
        assert.equal(isReadingScreen(ctx), false); assert.equal(tui.hasOverlay(), false);
        if (tui.mode === 'regular') assert.equal(readingRows(tui), 28, 'failed construction releases the viewport lease');
      } finally {native.dispose();}
    }
  } finally {await h.dispose();}
});

test('reading sessions retain each actual Suite frame through tabs, delayed history/pickers, resize and failures without stealing restored input', async () => {
  let context!: ExtensionContext;
  const h = await host({extend: pi => pi.on('session_start', (_event, ctx) => {context = ctx;})});
  try {
    for (const create of [readerTerminal, regularReaderTerminal]) {
      const native = create(24, 100), tui = native.tui;
      let mainInput = '', mainRevision = 0, disposals = 0;
      const editor = {render: () => Array(70).fill('MAIN HISTORY'),
        handleInput: (data: string) => {mainInput += data;}, invalidate() {}};
      const base = new VStack();
      base.addChild(editor, {grow: 1, minSize: 0});
      base.addChild({render: () => [`MAIN FOOTER ${mainRevision}`], invalidate() {}}, {basis: 1, shrink: 0});
      if (tui instanceof TuiAltScreen) tui.setLayoutRoot(base); else tui.addChild(base);
      tui.setFocus(editor); tui.renderNow();
      let ready = Promise.withResolvers<OverlayHandle>();
      const ctx: ExtensionContext = {...context, ui: {...context.ui, custom: (factory, options) => new Promise((resolve, reject) => {
        let handle: OverlayHandle | undefined, component: Awaited<ReturnType<typeof factory>> | undefined, closed = false;
        const done = (value: unknown) => {
          if (closed) return;
          closed = true; handle?.hide(); resolve(value as never); component?.dispose?.();
        };
        Promise.resolve().then(() => factory(tui, context.ui.theme, getKeybindings() as never, done)).then(value => {
          if (closed) return;
          component = value;
          handle = tui.showOverlay(value, typeof options?.overlayOptions === 'function' ? options.overlayOptions() : options?.overlayOptions);
          options?.onHandle?.(handle); tui.renderNow(); ready.resolve(handle);
        }).catch(reject);
      })}};
      // Observe the completed synchronized writes, not only the final overlay state.
      const write = tui.terminal.write.bind(tui.terminal);
      let snapshots: Promise<string[]>[] = [], painted = 0;
      tui.terminal.write = data => {write(data); if (data.includes('\x1b[?2026l')) snapshots.push(native.lines());};
      const frames = async (marker: RegExp, covered = tui.mode === 'fullscreen') => {
        const rendered = await Promise.all(snapshots.splice(0));
        for (const lines of rendered) {
          painted++;
          assert.match(lines.join('\n'), marker);
          if (covered) assert.doesNotMatch(lines.join('\n'), /MAIN FOOTER/);
        }
        const lines = await native.lines();
        assert.match(lines.join('\n'), marker);
        if (covered) assert.doesNotMatch(lines.join('\n'), /MAIN FOOTER/);
      };
      const browser = (name: string, delay?: Promise<void>) => openReading<void>(ctx, async (screen, theme, keys, done) => {
        await delay;
        const view = new BrowserView(screen, {title: name, state: browseState(), items: () => [],
          pages: {items: () => [{value: 'one', label: name}, {value: 'two', label: 'Next'}], selected: () => 'one', select: () => done()}}, () => done(), theme, keys);
        const dispose = view.dispose.bind(view);
        return Object.assign(view, {dispose: () => {disposals++; dispose();}});
      });
      try {
        await withReadingSession(ctx, async () => {
          assert.equal(isReadingSession(ctx), true); assert.equal(isReadingScreen(ctx), false);
          let page = browser('ROOT ONE');
          let handle = await ready.promise;
          assert.equal(handle.getBounds()?.width, tui.mode === 'regular' ? 90 : 100);
          assert.equal(handle.getBounds()?.height, readingRows(tui));
          snapshots = [];
          // Quick tab keys during construction are captured by the frozen page.
          for (const name of ['ROOT TWO', 'ROOT THREE']) {
            native.send(']'); await page;
            const gate = Promise.withResolvers<void>(); ready = Promise.withResolvers();
            page = browser(name, gate.promise);
            native.send(']'); native.send('ignored');
            native.resize(tui.terminal.rows + 4, 120);
            await frames(/ROOT (ONE|TWO)/);
            gate.resolve(); handle = await ready.promise;
            await frames(/ROOT (TWO|THREE)/);
          }
          native.send(']'); await page; await frames(/ROOT THREE/);
          await withReadingScreen(ctx, async () => {
            ready = Promise.withResolvers();
            const loading = Promise.withResolvers<void>();
            const history = openReading<void>(ctx, async (screen, theme, keys, done) => {
              await loading.promise;
              return new DetailsView(screen, () => 'HISTORY PAGE', new Text('HISTORY BODY', 0, 0), done, [], undefined, theme, {keys});
            });
            native.send('ignored'); tui.renderNow(); await frames(/ROOT THREE/);
            loading.resolve(); await ready.promise; await frames(/HISTORY PAGE/, true);
            native.send('\x1b'); await history; await frames(/HISTORY PAGE/, true);
            ready = Promise.withResolvers();
            const picker = selectValue(ctx, 'HISTORY PICKER', [{value: 'one', label: 'One'}], 'one');
            await ready.promise; await frames(/HISTORY PICKER/, true);
            native.send('\x1b'); await picker; await frames(/HISTORY PICKER/, true);
          });
          assert.equal(isReadingScreen(ctx), false);
          native.resize(40, 80); native.send('ignored');
          await frames(/HISTORY PICKER/, true);
          ready = Promise.withResolvers();
          const gate = Promise.withResolvers<void>();
          page = browser('ROOT RETURN', gate.promise);
          tui.renderNow(); await frames(/HISTORY PICKER/, true);
          gate.resolve(); await ready.promise; await frames(/ROOT RETURN/);
          native.send(']'); await page; await frames(/ROOT RETURN/);
          await assert.rejects(openReading(ctx, async () => {await Promise.resolve(); throw new Error('delayed factory failure');}), /delayed factory failure/);
          tui.renderNow(); await frames(/ROOT RETURN/);
          let earlyDispose = 0;
          await openReading<void>(ctx, (_screen, _theme, _keys, done) => {
            done(); return {render: () => ['NEVER MOUNTED'], invalidate() {}, dispose: () => {earlyDispose++;}};
          });
          assert.equal(earlyDispose, 1); tui.renderNow(); await frames(/ROOT RETURN/);
          mainRevision = 1;
          snapshots = [];
        });
        tui.renderNow();
        assert.equal(disposals, 4); assert.equal(mainInput, '');
        assert.ok(painted >= 6, `the contract observes actual changed paint writes (${painted}); unchanged frozen frames need no write`);
        assert.equal(isReadingSession(ctx), false); assert.equal(tui.hasOverlay(), false);
        assert.match((await native.lines()).join('\n'), /MAIN FOOTER 1/);
        native.send('restored'); assert.equal(mainInput, 'restored');
        // A failed next factory at the root boundary also removes the retained frame.
        await assert.rejects(withReadingSession(ctx, async () => {
          ready = Promise.withResolvers(); const page = browser('FAILURE ROOT');
          await ready.promise; native.send(']'); await page;
          return openReading(ctx, () => {throw new Error('root failure');});
        }), /root failure/);
        assert.equal(isReadingSession(ctx), false); assert.equal(tui.hasOverlay(), false);
        native.send(' again'); assert.equal(mainInput, 'restored again');
      } finally {native.dispose();}
    }
  } finally {await h.dispose();}
});
