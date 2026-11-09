import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const english = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
const base = {
  phase: 'synced', initialized: true, signedIn: true, encrypted: false, locked: false,
  lastSync: '2026-11-09T12:00:00Z', conflictCount: 0, settings: { enabled: true },
  tracking: { issueCount: 0 }, auth: { pending: false, error: null }, error: null, deviceTrust: { error: null },
};
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flat(Infinity).flatMap(flatten)];
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const success = value => ({ ok: true, json: async () => ({ ok: true, value }) });
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// This dependency-free hook fixture tests state, requests, and lifecycle, not browser geometry.
function harness({ available = true } = {}) {
  let definition, cursor = 0, refCursor = 0, effectCursor = 0, effects = [], nextTimer = 0;
  let active = 'en', localeRevision = 0;
  const states = [], refs = [], records = [], calls = [], replies = [];
  const intervals = new Map(), timeouts = new Map(), events = new Map(), localeListeners = new Set();
  const slots = new Map(), waiting = new Map(), disposers = [], dictionaries = {};
  const dialog = { open: false, shown: 0, closed: 0, showModal() { this.open = true; this.shown++; }, close() { this.open = false; this.closed++; } };
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) {
      if (type === 'dialog') props.ref.current = dialog;
      return { type, props: props || {}, children };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(value) { return refs[refCursor++] ??= { current: value }; },
    useEffect(callback, deps) {
      const index = effectCursor++, previous = records[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) {
        effects.push(() => { previous?.cleanup?.(); records[index] = { deps, cleanup: callback() }; });
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      React.useEffect(() => subscribe(() => {}), []);
      return snapshot();
    },
  };
  const document = {
    hidden: false,
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); },
  };
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load(value) { definition = value; } },
      addEventListener(name, fn) { events.set(name, fn); },
      removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); },
    },
    document, AbortController, URL,
    setInterval(fn, delay) { assert.equal(delay, 3000); intervals.set(++nextTimer, fn); return nextTimer; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, delay) { assert.equal(delay, 10000); timeouts.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timeouts.delete(id); },
    async fetch(url, options) {
      calls.push({ url, options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(options) : reply ?? success(base);
    },
  });
  const plugin = definition.factory(name => {
    if (name === 'react') return React;
    assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives');
    return { Tooltip: 'tooltip' };
  });
  plugin.apply({
    remote: {},
    effect(fn) { const dispose = fn(); if (dispose) disposers.push(dispose); },
    locale: {
      register(namespace, language, dict) {
        assert.equal(namespace, 'dsh-sync'); dictionaries[language] = dict;
        return () => { delete dictionaries[language]; };
      },
      bind: () => key => { const value = dictionaries[active]?.[key] ?? dictionaries.en[key]; assert.ok(value, key); return value; },
      getSnapshot: () => ({ active, revision: localeRevision }),
      subscribe(fn) { localeListeners.add(fn); return () => localeListeners.delete(fn); },
    },
    slots: {
      inject(name, fn) {
        let dispose;
        if (name !== 'sidebar.footer.action' || available) dispose = fn();
        else waiting.set(name, () => { dispose = fn(); });
        return () => { waiting.delete(name); dispose?.(); };
      },
      register(options, Component) {
        slots.set(options.name, { options, Component });
        return () => { slots.delete(options.name); };
      },
    },
  });
  const render = (wide = true) => {
    cursor = 0; refCursor = 0; effectCursor = 0; effects = [];
    return slots.get('sidebar.footer.action').Component({ wide });
  };
  const commit = (wide = true) => { const tree = render(wide); for (const effect of effects) effect(); return tree; };
  return {
    calls, replies, states, intervals, timeouts, events, document, dialog, slots, waiting, localeListeners,
    render, commit,
    button(wide = true) { return flatten(render(wide)).find(node => node.type === 'button'); },
    tooltip() { return flatten(render()).find(node => node.type === 'tooltip').props.label; },
    async mount() { commit(); await flush(); },
    async tick() { for (const callback of intervals.values()) callback(); await flush(); },
    switchLanguage(language) { active = language; localeRevision++; for (const callback of localeListeners) callback(); },
    unmount() { for (const record of records) record?.cleanup?.(); },
    dispose() { for (const dispose of disposers.reverse()) dispose(); },
  };
}

const statusText = app => flatten(app.render()).find(node => node.props.role === 'status')?.children[0];

test('footer contribution waits for its declaration and is removed on plugin disposal', () => {
  const app = harness({ available: false });
  assert.equal(app.slots.has('sidebar.footer.action'), false);
  app.waiting.get('sidebar.footer.action')();
  assert.equal(app.slots.get('sidebar.footer.action').options.id, 'dsh-sync');
  assert.equal(app.slots.get('sidebar.footer.action').options.order, 25);
  app.dispose();
  assert.equal(app.slots.size, 0); assert.equal(app.waiting.size, 0);
});

test('visible sidebar polls metadata only and exposes hover, keyboard, and compact-rail labels', async () => {
  const app = harness();
  assert.equal(statusText(app), english.sidebarLoading);
  await app.mount();
  assert.equal(statusText(app), english.phaseSynced);
  assert.equal(app.calls[0].url, '/api/dsh-sync?view=summary');
  assert.equal(app.calls[0].options.credentials, 'same-origin');
  assert.equal(app.calls[0].options.cache, 'no-store');
  assert.equal(app.calls[0].options.body, undefined);
  assert.match(app.tooltip(), /Last successful sync/);
  assert.ok(app.tooltip().includes(english.sidebarHelpSynced));
  const narrow = app.button(false);
  assert.equal(narrow.props['aria-haspopup'], 'dialog');
  assert.ok(narrow.props['aria-label'].includes(english.phaseSynced));
  assert.ok(narrow.props['aria-description'].includes(english.sidebarHelpSynced));
  assert.ok(!flatten(app.render(false)).some(node => node.props.role === 'status'));
  app.document.hidden = true; await app.tick(); assert.equal(app.calls.length, 1);
  app.document.hidden = false; app.events.get('visibilitychange')(); await flush(); assert.equal(app.calls.length, 2);
  app.events.get('focus')(); await flush(); assert.equal(app.calls.length, 3);
  app.unmount();
  assert.equal(app.intervals.size, 0); assert.equal(app.timeouts.size, 0); assert.equal(app.events.size, 0); assert.equal(app.localeListeners.size, 0);
});

for (const [name, overrides, expected, tone] of [
  ['syncing', { phase: 'syncing' }, 'phaseSyncing', 'neutral'],
  ['conflict', { phase: 'conflict', conflictCount: 2 }, 'phaseConflict', 'warning'],
  ['conflict overrides lock', { conflictCount: 1, locked: true }, 'phaseConflict', 'warning'],
  ['locked without a locked phase', { locked: true, encrypted: true }, 'phaseLocked', 'warning'],
  ['signed out', { signedIn: false }, 'sidebarSignedOut', 'warning'],
  ['setup required', { initialized: false }, 'sidebarSetup', 'neutral'],
  ['reauthorization required', { phase: 'error', error: { code: 'reauth-required' } }, 'sidebarSignedOut', 'warning'],
  ['network failed', { phase: 'error', error: { code: 'network-failed' } }, 'sidebarUnavailable', 'error'],
  ['OneDrive permission errors are not labeled network failure', { phase: 'error', error: { code: 'graph-error' } }, 'sidebarError', 'error'],
  ['local file errors', { phase: 'error', error: { code: 'EACCES' } }, 'sidebarError', 'error'],
  ['device trust errors', { deviceTrust: { error: { code: 'device-cache-failed' } } }, 'sidebarError', 'error'],
  ['inventory errors', { tracking: { issueCount: 2 } }, 'sidebarIssues', 'warning'],
  ['paused', { settings: { enabled: false } }, 'sidebarPaused', 'neutral'],
  ['pending', { phase: 'pending' }, 'sidebarPending', 'neutral'],
  ['idle is ready rather than claiming known changes', { phase: 'idle' }, 'phaseIdle', 'neutral'],
  ['never synced', { lastSync: null }, 'sidebarPending', 'neutral'],
]) {
  test(`sidebar reports ${name} without claiming success`, async () => {
    const app = harness(); app.replies.push(success({ ...base, ...overrides })); await app.mount();
    assert.equal(statusText(app), english[expected]); assert.equal(app.button().props['data-tone'], tone);
    app.unmount();
  });
}

test('a failed summary replaces stale success and focus can recover it', async () => {
  const app = harness(); await app.mount();
  app.replies.push(new Error('NETWORK-DETAILS-MUST-NOT-APPEAR')); await app.tick();
  assert.equal(statusText(app), english.sidebarUnavailable);
  assert.ok(!app.tooltip().includes('NETWORK-DETAILS'));
  assert.ok(!app.tooltip().includes('2026'));
  app.events.get('focus')(); await flush();
  assert.equal(statusText(app), english.phaseSynced); app.unmount();
});

for (const reply of [
  { ok: false, json: async () => ({ ok: false, error: { message: 'PRIVATE-DIAGNOSTIC' } }) },
  { ok: true, json: async () => { throw new Error('Not JSON'); } },
  success(null), success({ ...base, phase: 'unrecognized' }), success({ ...base, signedIn: 'true' }),
  success({ ...base, tracking: {} }), success({ ...base, lastSync: 'invalid date' }),
]) {
  test('HTTP, parse, and malformed metadata responses cannot become green success', async () => {
    const app = harness(); app.replies.push(reply); await app.mount();
    assert.equal(statusText(app), english.sidebarUnavailable); assert.equal(app.button().props['data-tone'], 'error');
    app.unmount();
  });
}

test('summary requests do not overlap and a timeout aborts the request', async () => {
  const app = harness(), pending = deferred();
  app.replies.push(options => new Promise((resolve, reject) => {
    pending.promise.then(resolve);
    options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }));
  await app.mount(); await app.tick(); app.events.get('focus')(); await flush();
  assert.equal(app.calls.length, 1);
  for (const callback of app.timeouts.values()) callback(); await flush();
  assert.equal(app.calls[0].options.signal.aborted, true);
  assert.equal(statusText(app), english.sidebarUnavailable);
  await app.tick(); assert.equal(statusText(app), english.phaseSynced);
  app.unmount();
});

test('unmount aborts in-flight work and ignores late responses', async () => {
  const app = harness(), pending = deferred(); app.replies.push(() => pending.promise);
  await app.mount(); app.unmount();
  assert.equal(app.calls[0].options.signal.aborted, true);
  assert.equal(app.timeouts.size, 0); assert.equal(app.intervals.size, 0); assert.equal(app.events.size, 0);
  pending.resolve(success(base)); await flush();
  assert.equal(statusText(app), english.sidebarLoading);
});

test('opening the sidebar dialog reuses the full settings component without synchronizing', async () => {
  const app = harness(); await app.mount();
  app.button().props.onClick(); let tree = app.commit(); await flush();
  assert.equal(app.dialog.open, true); assert.equal(app.dialog.shown, 1);
  assert.equal(app.button().props['aria-expanded'], true);
  const element = flatten(tree).find(node => node.type === 'dialog');
  const child = element.children.find(node => typeof node?.type === 'function');
  assert.equal(child.type, app.slots.get('settings.section').Component);
  assert.equal(app.calls.filter(call => call.options.method === 'POST').length, 0);
  let prevented = false;
  element.props.onCancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(app.button().props['aria-expanded'], true, 'No close before the settings close guard is mounted.');
  child.props.closeRequest.current = child.props.onClose;
  element.props.onCancel({ target: {}, currentTarget: {}, preventDefault() { assert.fail('Nested cancellation must stay with its child dialog.'); } });
  assert.equal(app.button().props['aria-expanded'], true);
  element.props.onCancel({ preventDefault() {} }); tree = app.commit(); await flush();
  assert.equal(app.dialog.open, false); assert.equal(app.dialog.closed, 1);
  assert.ok(!flatten(tree).some(node => node.type === 'dialog'));
  app.unmount();
});

test('status labels and tooltips follow the active DSH locale without restarting requests', async () => {
  const app = harness(); await app.mount(); const calls = app.calls.length;
  app.switchLanguage('zh');
  assert.equal(statusText(app), '已同步'); assert.ok(app.tooltip().includes('上次成功同步'));
  app.switchLanguage('ja');
  assert.ok(!app.tooltip().includes(english.sidebarHelpSynced));
  assert.equal(app.calls.length, calls); app.unmount();
});

test('sidebar styles honor reduced motion and native dialog layering without absolute sidebar anchoring', () => {
  assert.match(source, /prefers-reduced-motion:reduce/);
  assert.match(source, /\.dsh-sync-sidebar-dialog::backdrop/);
  assert.doesNotMatch(source, /querySelector|MutationObserver/);
});
