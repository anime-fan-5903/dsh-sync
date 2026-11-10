import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flat(Infinity).flatMap(flatten)];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const success = value => ({ ok: true, json: async () => ({ ok: true, value }) });
const item = { id: 'fixture', name: 'fixture-bundle', version: '1.2.3', enabled: true, source: 'registry', kind: 'missing', fingerprint: 'exact-fingerprint', canInstall: true };
const base = { enabled: true, available: true, pendingCount: 1, items: [item], progress: null };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

// Run the registered child component with isolated hooks; no real plugin manager or React dependencies.
function harness() {
  let definition, current, nextTimer = 0, activeLocale = 'en', closed = 0, managed = 0, notified = 0;
  const dictionaries = {}, slots = new Map(), disposers = [], listeners = new Set();
  const calls = [], replies = [], gets = [], intervals = new Map(), timeouts = new Map();
  const document = { hidden: false };
  const React = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const runner = current, index = runner.cursor++;
      if (!(index in runner.states)) runner.states[index] = initial;
      return [runner.states[index], value => { runner.states[index] = typeof value === 'function' ? value(runner.states[index]) : value; runner.updates++; }];
    },
    useRef(initial) { return current.refs[current.refCursor++] ??= { current: initial }; },
    useEffect(callback, deps) {
      const runner = current, index = runner.effectCursor++, previous = runner.records[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) {
        runner.effects.push(() => { previous?.cleanup?.(); runner.records[index] = { deps, cleanup: callback() }; });
      }
    },
    useSyncExternalStore(subscribe, snapshot) { React.useEffect(() => subscribe(() => {}), []); return snapshot(); },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value; } } }, document, AbortController, URL,
    setInterval(callback, delay) { assert.equal(delay, 3000); intervals.set(++nextTimer, callback); return nextTimer; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { assert.equal(delay, 10000); timeouts.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timeouts.delete(id); },
    async fetch(url, options) {
      calls.push({ url, options });
      const response = (options.method === 'POST' ? replies : gets).shift();
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response(options) : response ?? success(options.method === 'POST' ? {} : base);
    },
  });
  definition.factory(name => name === 'react' ? React : { Tooltip: 'tooltip' }).apply({
    remote: {},
    effect(callback) { const dispose = callback(); if (dispose) disposers.push(dispose); },
    locale: {
      register(_namespace, language, dictionary) { dictionaries[language] = dictionary; return () => { delete dictionaries[language]; }; },
      bind: () => key => { const value = dictionaries[activeLocale]?.[key] ?? dictionaries.en[key]; assert.ok(value, key); return value; },
      subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
      getSnapshot: () => ({ active: activeLocale }),
    },
    slots: {
      inject(_name, callback) { return callback(); },
      register(options, component) { slots.set(options.name, component); return () => slots.delete(options.name); },
    },
  });
  function runner(Component, props) {
    const value = { states: [], refs: [], records: [], effects: [], updates: 0 };
    value.render = () => { current = value; value.cursor = 0; value.refCursor = 0; value.effectCursor = 0; value.effects = []; return Component(props); };
    value.commit = () => { const tree = value.render(); for (const effect of value.effects) effect(); return tree; };
    value.unmount = () => { for (const record of value.records) record?.cleanup?.(); };
    return value;
  }
  const sidebar = runner(slots.get('sidebar.footer.action'), { wide: true });
  sidebar.states[0] = { phase: 'synced', signedIn: true, initialized: true, settings: { enabled: true }, tracking: { issueCount: 0 }, lastSync: '2026-11-10T00:00:00Z', plugins: { pendingCount: 1 } };
  flatten(sidebar.render()).find(node => node.type === 'button').props.onClick();
  const Component = flatten(sidebar.render()).find(node => node.type?.name === 'PluginRestore').type;
  const panel = runner(Component, { onClose() { closed++; }, onManage() { managed++; }, onStatusChange() { notified++; } });
  const button = key => { const value = flatten(panel.render()).find(node => node.type === 'button' && node.children.includes(en[key])); assert.ok(value, key); return value; };
  return {
    calls, replies, gets, panel, document, intervals, timeouts, listeners, slots, button,
    get closed() { return closed; }, get managed() { return managed; }, get notified() { return notified; },
    boxes: () => flatten(panel.render()).filter(node => node.type === 'input'),
    text: () => JSON.stringify(panel.render()),
    async mount() { panel.commit(); await flush(); },
    async tick() { for (const callback of intervals.values()) callback(); await flush(); },
    unmount: panel.unmount,
    dispose() { panel.unmount(); for (const dispose of disposers.reverse()) dispose(); },
    locale(language) { activeLocale = language; },
  };
}

test('restoration polls only metadata and submits exact displayed eligible choices without another confirmation', async () => {
  const app = harness();
  app.gets.push(success({ ...base, items: [item, { ...item, id: 'manual', kind: 'version-difference', localVersion: '2.0.0', canInstall: false }] }));
  await app.mount();
  assert.equal(app.calls[0].url, '/api/dsh-sync?view=plugins');
  assert.equal(app.calls[0].options.credentials, 'same-origin');
  assert.equal(app.calls[0].options.cache, 'no-store');
  assert.equal(app.boxes()[0].props.checked, true); assert.equal(app.boxes()[1].props.checked, false); assert.equal(app.boxes()[1].props.disabled, true);
  for (const text of [en.pluginsWarning, en.pluginsManualHelp, 'fixture-bundle @ 1.2.3', 'registry', en.pluginsEnabled, '2.0.0']) assert.ok(app.text().includes(text));
  assert.ok(!flatten(app.panel.render()).some(node => node.type === 'dialog'));
  await app.button('pluginsInstall').props.onClick(); await flush();
  const posts = app.calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].options.body), { action: 'plugins-install', choices: [{ id: item.id, fingerprint: item.fingerprint }] });
  assert.equal(app.notified, 1); app.dispose();
});

test('refresh retains choices only for the same fingerprint and submits the new exact revision', async () => {
  const app = harness(); await app.mount();
  app.boxes()[0].props.onChange({ target: { checked: false } }); await app.tick();
  assert.equal(app.boxes()[0].props.checked, false); assert.equal(app.button('pluginsInstall').props.disabled, true);
  app.gets.push(success({ ...base, items: [{ ...item, fingerprint: 'new-exact-fingerprint', version: '1.2.4' }] })); await app.tick();
  assert.equal(app.boxes()[0].props.checked, true);
  await app.button('pluginsInstall').props.onClick(); await flush();
  assert.deepEqual(JSON.parse(app.calls.find(call => call.options.method === 'POST').options.body).choices, [{ id: item.id, fingerprint: 'new-exact-fingerprint' }]);
  app.dispose();
});

test('ignore sends only the exact device-local item and later or detailed management sends no authorization', async () => {
  const app = harness(); await app.mount();
  app.button('pluginsLater').props.onClick(); app.button('pluginsManage').props.onClick();
  assert.equal(app.closed, 1); assert.equal(app.managed, 1); assert.equal(app.calls.filter(call => call.options.method === 'POST').length, 0);
  await app.button('pluginsIgnore').props.onClick(); await flush();
  assert.deepEqual(JSON.parse(app.calls.find(call => call.options.method === 'POST').options.body), { action: 'plugins-ignore', id: item.id, fingerprint: item.fingerprint });
  app.dispose();
});

test('long installation leaves polling and close usable, and closing never aborts authorized work', async () => {
  const app = harness(), pending = deferred(); await app.mount();
  app.replies.push(() => pending.promise);
  const action = app.button('pluginsInstall').props.onClick();
  assert.equal(app.button('pluginsInstall').props.disabled, true);
  assert.ok(!app.button('pluginsLater').props.disabled);
  app.gets.push(success({ ...base, progress: { current: 1, total: 2, name: 'fixture-bundle' } })); await app.tick();
  assert.ok(app.text().includes('1/2 · fixture-bundle'));
  assert.ok(app.text().includes(en.pluginsInstalling));
  app.button('pluginsLater').props.onClick(); app.unmount();
  const updates = app.panel.updates;
  const post = app.calls.find(call => call.options.method === 'POST'); assert.equal(post.options.signal, undefined);
  pending.resolve(success({})); await action; await flush();
  assert.equal(app.panel.updates, updates); assert.equal(app.notified, 0);
  assert.equal(app.intervals.size, 0); assert.equal(app.timeouts.size, 0); assert.equal(app.listeners.size, 0);
});

for (const [code, key] of [['build-blocked', 'pluginsBuildBlocked'], ['incompatible-version', 'pluginsIncompatible'], ['restart-required', 'pluginsRestart'], ['failed', 'pluginsFailed']]) {
  test(`post-operation ${code} remains actionable rather than false success`, async () => {
    const app = harness(); await app.mount();
    app.gets.push(success({ ...base, items: [{ ...item, canInstall: false, code }] }));
    await app.button('pluginsInstall').props.onClick(); await flush();
    assert.ok(app.text().includes(en[key])); assert.equal(app.button('pluginsInstall').props.disabled, true);
    assert.ok(app.text().includes(`${en.pluginsPending}: 1`));
    assert.ok(app.button('pluginsManage')); app.dispose();
  });
}

test('metadata failures remove stale install authority and show localized safe errors', async () => {
  const app = harness(); await app.mount();
  app.gets.push(new Error('PRIVATE-DIAGNOSTICS')); await app.tick();
  assert.equal(app.button('pluginsInstall').props.disabled, true);
  assert.ok(app.text().includes(en.pluginsLoadFailed)); assert.ok(!app.text().includes('PRIVATE-DIAGNOSTICS'));
  await app.tick(); assert.equal(app.button('pluginsInstall').props.disabled, false);
  app.replies.push({ ok: false, json: async () => ({ ok: false, error: { code: 'stale-choice', message: 'PRIVATE-DIAGNOSTICS' } }) });
  await app.button('pluginsInstall').props.onClick(); await flush();
  assert.ok(app.text().includes(en.pluginsStale)); assert.ok(!app.text().includes('PRIVATE-DIAGNOSTICS'));
  app.locale('zh'); assert.ok(app.text().includes('插件清单已变化')); app.dispose();
});

test('poll requests do not overlap, stop while hidden, and late replies cannot update an unmounted panel', async () => {
  const app = harness(), pending = deferred(); app.gets.push(() => pending.promise); await app.mount();
  await app.tick(); assert.equal(app.calls.length, 1);
  app.document.hidden = true; await app.tick(); assert.equal(app.calls.length, 1);
  const updates = app.panel.updates; app.unmount();
  assert.equal(app.calls[0].options.signal.aborted, true);
  pending.resolve(success(base)); await flush();
  assert.equal(app.panel.updates, updates); assert.equal(app.intervals.size, 0); assert.equal(app.timeouts.size, 0);
});

test('the concise panel omits settled and ignored inventory but retains installed restart outcomes', async () => {
  const app = harness();
  app.gets.push(success({ ...base, items: [
    item,
    { ...item, id: 'settled', name: 'settled-bundle', kind: 'installed', canInstall: false },
    { ...item, id: 'ignored', name: 'ignored-bundle', kind: 'ignored', canInstall: false },
    { ...item, id: 'restart', name: 'restart-bundle', kind: 'installed', code: 'restart-required', canInstall: false },
  ] })); await app.mount();
  assert.ok(!app.text().includes('settled-bundle')); assert.ok(!app.text().includes('ignored-bundle'));
  assert.ok(app.text().includes('restart-bundle')); assert.ok(app.text().includes(en.pluginsRestart)); app.dispose();
});

for (const kind of ['installed', 'current']) {
  for (const code of ['failed', 'build-blocked', 'incompatible-version', 'restart-required']) {
    test(`${kind} ${code} reminder can be dismissed only with its exact fingerprint`, async () => {
      const app = harness();
      const retained = { ...item, kind, code, canInstall: false, fingerprint: `${kind}-${code}-exact` };
      app.gets.push(success({ ...base, items: [retained] })); await app.mount();
      app.gets.push(success({ ...base, pendingCount: 0, items: [{ ...retained, kind: 'ignored' }] }));
      await app.button('pluginsIgnore').props.onClick(); await flush();
      assert.deepEqual(JSON.parse(app.calls.find(call => call.options.method === 'POST').options.body), {
        action: 'plugins-ignore', id: retained.id, fingerprint: retained.fingerprint,
      });
      assert.ok(!app.text().includes(retained.name));
      assert.ok(app.text().includes(`${en.pluginsPending}: 0`)); app.dispose();
    });
  }
}

test('unknown operation failures never render raw diagnostics or claim success', async () => {
  const app = harness(); await app.mount();
  app.replies.push({ ok: false, json: async () => ({ ok: false, error: { code: 'unrecognized', message: 'PRIVATE-RAW-DETAIL' } }) });
  await app.button('pluginsInstall').props.onClick(); await flush();
  assert.ok(app.text().includes(en.pluginsActionFailed)); assert.ok(!app.text().includes('PRIVATE-RAW-DETAIL'));
  app.replies.push(new Error('PRIVATE-NETWORK-DETAIL'));
  await app.button('pluginsInstall').props.onClick(); await flush();
  assert.ok(app.text().includes(en.pluginsActionFailed)); assert.ok(!app.text().includes('PRIVATE-NETWORK-DETAIL')); app.dispose();
});

test('HMR removal clears panel subscriptions and requests along with slot contributions', async () => {
  const app = harness(), pending = deferred(); app.gets.push(() => pending.promise); await app.mount();
  const updates = app.panel.updates; app.dispose();
  pending.resolve(success(base)); await flush();
  assert.equal(app.panel.updates, updates); assert.equal(app.slots.size, 0); assert.equal(app.listeners.size, 0); assert.equal(app.intervals.size, 0);
});

for (const value of [{ ...base, enabled: false }, { ...base, available: false }, { ...base, pendingCount: -1 }]) {
  test('disabled, unavailable and malformed plugin views cannot authorize installation', async () => {
    const app = harness(); app.gets.push(success(value)); await app.mount();
    assert.equal(app.button('pluginsInstall').props.disabled, true); app.dispose();
  });
}
