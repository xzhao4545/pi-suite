import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Text, VStack, TuiAltScreen, getKeybindings, type OverlayHandle } from '@earendil-works/pi-tui';
import { withReadingScreen, openReading, readingRows, isReadingScreen } from '../../src/ui/reading.ts';
import { DetailsView } from '../../src/ui/details.ts';
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
        let handle: OverlayHandle, dispose: (() => void) | undefined;
        Promise.resolve().then(() => factory(tui, context.ui.theme, getKeybindings() as never, value => {
          handle.hide(); dispose?.(); resolve(value);
        })).then(component => {
          dispose = component.dispose?.bind(component);
          handle = tui.showOverlay(component, typeof options?.overlayOptions === 'function' ? options.overlayOptions() : options?.overlayOptions);
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
