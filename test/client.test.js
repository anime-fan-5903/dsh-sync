import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const english = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));
const base = {
  initialized: true, phase: 'synced', encrypted: false, locked: false, signedIn: true,
  settings: { clientId: 'example-client', enabled: true }, assets: [], backups: [], conflicts: [],
};
// The small hook harness exercises the plain-JS view contract without a React dependency.
// It is not a browser layout test or a replacement for installed-client verification.
const stateNames = ['status','error','notice','pending','encrypted','passphrase','confirmation','secret','method','recovery','savedRecovery','choices','confirm','loadError','loginUrl','recoveryCopyStatus'];
const state = Object.fromEntries(stateNames.map((name,index) => [name,index]));
const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...node.children.flat(Infinity).flatMap(flatten)];
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(initialLanguage = 'en') {
  let definition, component, dictionary, cursor = 0, refCursor = 0, effectCursor = 0, effects = [];
  const dictionaries = {}, localeListeners = new Set(), disposers = [];
  let localeSnapshot = { revision: 1, active: initialLanguage }, localeNotifications = 0;
  const translation = key => dictionaries[localeSnapshot.active]?.[key] ?? dictionaries.en?.[key];
  const effectRecords = [], clipboardWrites = [];
  const dialog = { open: false, showModalCalls: 0, closeCalls: 0,
    showModal() { this.open = true; this.showModalCalls++; }, close() { this.open = false; this.closeCalls++; } };
  const trackingDialog = { open: false, showModalCalls: 0, closeCalls: 0,
    showModal() { this.open = true; this.showModalCalls++; }, close() { this.open = false; this.closeCalls++; } };
  const states = [], refs = [], calls = [], replies = [], getReplies = [], events = new Map(), timers = new Map(), tabs = [], opens = [];
  let blockPopup = false; let desktopExternal = false; let throwOnOpen = false;
  const React = {
    createElement(type, props, ...children) {
      if (type === 'dialog' && props?.ref) props.ref.current = props['aria-labelledby'] === 'dsh-sync-tracking-confirm-title' ? trackingDialog : dialog;
      return { type, props: props || {}, children };
    },
    Fragment: Symbol('fragment'),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(value) { const index = refCursor++; return refs[index] ??= { current: value }; },
    useEffect(callback, deps) {
      const index = effectCursor++; const previous = effectRecords[index];
      if (!previous || !deps || deps.some((value, at) => !Object.is(value, previous.deps?.[at]))) {
        effects.push(() => { previous?.cleanup?.(); effectRecords[index] = { deps, cleanup: callback() }; });
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      React.useEffect(() => subscribe(() => { localeNotifications++; }), []);
      return snapshot();
    },
  };
  const editorCalls = [], availabilityReplies = [], openReplies = [];
  const remote = { session: {
    async canOpenWorkspacePath() {
      editorCalls.push({ method: 'available' }); const reply = availabilityReplies.shift();
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply() : reply ?? { ok: true, value: true };
    },
    async openWorkspacePath(request) {
      editorCalls.push({ method: 'open', request: JSON.parse(JSON.stringify(request)) }); const reply = openReplies.shift();
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(request) : reply ?? { ok: true, value: { opened: true } };
    },
  } };
  const window = {
    __ModuleLoader__: { load(value) { definition = value; } },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    open(url, target, features) {
      assert.match(url, /^https:\/\/login\.microsoftonline\.com\//); assert.equal(target, '_blank');
      assert.equal(features, 'noopener,noreferrer'); opens.push(url);
      if (throwOnOpen) throw new Error('External browser unavailable.');
      if (blockPopup || desktopExternal) return null;
      const tab = { opener: null, url, closed: false, close() { this.closed = true; } };
      tabs.push(tab); return tab;
    },
  };
  const document = {
    hidden: false,
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
  };
  const success = value => ({ ok: true, json: async () => ({ ok: true, value }) });
  vm.runInNewContext(source, {
    window, document, navigator: { clipboard: { writeText: async value => { clipboardWrites.push(value); } } },
    crypto: globalThis.crypto, URL, AbortController,
    setInterval(fn, delay) { assert.equal(delay, 3000); timers.set(1, fn); return 1; },
    clearInterval: id => timers.delete(id),
    async fetch(url, options) {
      calls.push({ url, options });
      if (options.method === 'GET') {
        if (!getReplies.length) return success(base);
        const reply = getReplies.shift();
        if (reply instanceof Error) throw reply;
        return typeof reply === 'function' ? reply(options) : reply;
      }
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (typeof reply === 'function') return reply(options);
      return success(reply);
    },
  });
  assert.equal(definition.id, 'dsh-sync');
  const plugin = definition.factory(name => { assert.equal(name, 'react'); return React; });
  assert.deepEqual(Array.from(plugin.inject), ['slots','locale','remote','remote.session']);
  plugin.apply({
    remote,
    effect: fn => { const dispose = fn(); if (dispose) disposers.push(dispose); },
    locale: {
      register(namespace, language, dict) {
        assert.equal(namespace, 'dsh-sync'); assert.ok(!dictionaries[language]);
        dictionaries[language] = dict; if (language === 'en') dictionary = dict;
        return () => { delete dictionaries[language]; };
      },
      bind: () => key => { const value = translation(key); assert.ok(value, `Missing translation: ${key}`); return value; },
      subscribe: callback => { localeListeners.add(callback); return () => localeListeners.delete(callback); },
      getSnapshot: () => localeSnapshot,
    },
    slots: {
      inject(name, fn) { assert.equal(name, 'settings.section'); fn(); return () => {}; },
      register(options, view) {
        assert.equal(options.id, 'dsh-sync'); assert.equal(options.order, 25); assert.equal(options.label(), 'DSH Sync');
        component = view; return () => {};
      },
    },
  });
  const render = () => { cursor = 0; refCursor = 0; effectCursor = 0; effects = []; return component(); };
  const commit = () => { const tree = render(); for (const effect of effects) effect(); return tree; };
  const button = label => {
    const found = flatten(render()).find(node => node.type === 'button' && node.children.includes(label));
    assert.ok(found, `Button not found: ${label}`); return found;
  };
  return {
    states, calls, replies, getReplies, tabs, opens, events, timers, document, dictionary, render, commit, dialog, trackingDialog, clipboardWrites, button, success, remote, editorCalls, availabilityReplies, openReplies,
    dictionaries, localeListeners,
    get localeNotifications() { return localeNotifications; },
    switchLanguage(active) {
      localeSnapshot = { revision: localeSnapshot.revision + 1, active };
      for (const callback of localeListeners) callback();
    },
    disposePlugin() { for (const dispose of disposers.reverse()) dispose(); },
    blockPopup() { blockPopup = true; },
    desktopExternal() { desktopExternal = true; },
    throwOnOpen() { throwOnOpen = true; },
    async mount() { commit(); await flush(); },
    unmount() { for (const record of effectRecords) record?.cleanup?.(); },
    click(label) { const item = button(label); assert.ok(!item.props.disabled, label); return item.props.onClick(); },
  };
}

test('module registration, dictionary parity, exported icon, and exact state theme tokens', () => {
  const app = harness();
  for (const [key, value] of Object.entries(english)) if (key !== 'meta') assert.equal(app.dictionary[key], value);
  assert.equal(english.meta.title, 'DSH Sync');
  const icon = new URL('../icon.svg', import.meta.url);
  assert.ok(statSync(icon).size < 256 * 1024);
  assert.match(readFileSync(icon, 'utf8'), /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(source, /--dsw-alias-state-warn-primary/);
  assert.match(source, /--dsw-alias-state-success-primary/);
  assert.doesNotMatch(source, /--dsw-alias-(?:warn|success)-primary/);
});

test('loading, setup, encrypted, locked, asset and backup states render', () => {
  const app = harness();
  for (const status of [null, { ...base, initialized: false, signedIn: false }, base,
    { ...base, encrypted: true, locked: true },
    { ...base, encrypted: true, assets: [{ id: 'a', name: 'Example', type: 'prompt' }], backups: [{ id: 'b', side: 'remote', createdAt: '2026-11-07T00:00:00Z' }] }]) {
    app.states[state.status] = status;
    assert.equal(app.render().props.className, 'dsh-sync');
  }
  app.states[state.status] = base;
  assert.ok(!flatten(app.render()).some(node => node.type === 'textarea'));
});

test('recovery key blocks actions until explicitly confirmed and warns before unload', async () => {
  const app = harness(); await app.mount();
  app.states[state.recovery] = 'TEST-RECOVERY-KEY';
  assert.equal(app.button('Sync now').props.disabled, true);
  assert.equal(app.button('I have saved the key — continue').props.disabled, true);
  let prevented = false;
  app.events.get('beforeunload')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  app.states[state.savedRecovery] = true;
  app.click('I have saved the key — continue');
  assert.equal(app.states[state.recovery], '');
  assert.equal(app.button('Sync now').props.disabled, false);
  app.unmount();
});

test('connection uses the built-in application without an editable ID or save step', async () => {
  const app = harness(); await app.mount();
  app.states[state.status] = { ...base, initialized: false, signedIn: false, settings: {} };
  const tree = app.render();
  assert.ok(flatten(tree).some(node => node.children.includes(english.applicationHelp)));
  assert.ok(!JSON.stringify(tree).includes('Microsoft application (client) ID'));
  assert.ok(!flatten(tree).some(node => node.type === 'button' && node.children.includes('Save configuration')));
  assert.equal(app.button('Sign in with Microsoft').props.disabled, false);
  app.unmount();
});

for (const [action, label, status] of [
  ['initialize', 'Initialize or join', { ...base, initialized: false }],
  ['enable-encryption', 'Enable encryption', base],
  ['change-passphrase', 'Change passphrase', { ...base, encrypted: true, locked: false }],
]) {
  test(`${action} immediately presents a non-dismissible recovery modal`, async () => {
    const app = harness(); await app.mount(); app.states[state.status] = status;
    app.states[state.encrypted] = true;
    app.states[state.passphrase] = 'A long fixture passphrase'; app.states[state.confirmation] = 'A long fixture passphrase';
    app.states[state.savedRecovery] = true;
    app.replies.push({ recoveryKey: 'FIXTURE-ONE-TIME-KEY' });
    app.click(label); await flush();
    const tree = app.commit(); const modal = flatten(tree).find(node => node.type === 'dialog');
    assert.ok(modal); assert.equal(app.dialog.open, true); assert.equal(app.dialog.showModalCalls, 1);
    assert.equal(modal.props.role, 'dialog'); assert.equal(modal.props['aria-modal'], true);
    assert.ok(flatten(modal).some(node => node.children.includes(english.recoveryOnce)));
    assert.ok(flatten(modal).some(node => node.children.includes(english.recoveryWarning)));
    assert.equal(app.button(english.recoveryConfirm).props.disabled, true);
    let canceled = false; modal.props.onCancel({ preventDefault() { canceled = true; } }); assert.equal(canceled, true);
    let prevented = false; let stopped = false;
    modal.props.onKeyDownCapture({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented && stopped, true); assert.equal(app.dialog.open, true);
    await app.click(english.recoveryCopy); await flush();
    assert.deepEqual(app.clipboardWrites, ['FIXTURE-ONE-TIME-KEY']);
    assert.equal(app.button(english.recoveryConfirm).props.disabled, true, 'Copy alone must not acknowledge safe storage.');
    const checkbox = flatten(modal).find(node => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(app.button(english.recoveryCopy).props.autoFocus, true);
    assert.equal(checkbox.props.autoFocus, undefined); checkbox.props.onChange({ target: { checked: true } });
    app.click(english.recoveryConfirm); app.commit();
    assert.equal(app.dialog.open, false); assert.equal(app.states[state.recovery], '');
    assert.ok(!JSON.stringify(app.render()).includes('FIXTURE-ONE-TIME-KEY'));
    assert.equal(JSON.parse(app.calls.find(call => call.options.method === 'POST').options.body).action, action);
    app.unmount();
  });
}

const trackedPrompt = { id: 'native-prompt', origin: { root: 'dsh', path: 'AGENTS.md' }, type: 'prompt', name: 'Global instructions', fileCount: null, excluded: false, present: true, pendingCloudDelete: false, cloudPresent: true };
function trackingStatus(items = [trackedPrompt], agentsEnabled = false) {
  return { ...base, tracking: { agentsEnabled, items, issues: [], lastScan: '2026-11-07T12:00:00Z' } };
}
function findCard(app, title) {
  return flatten(app.render()).find(node => node.type === 'section' && node.children.some(child => child?.type === 'h3' && child.children.includes(title)));
}
function findCheckbox(app, label) {
  const row = flatten(app.render()).find(node => node.type === 'label' && node.children.includes(label));
  assert.ok(row, `Checkbox label missing: ${label}`); return row.children.find(node => node?.type === 'input');
}
function postBodies(app) { return app.calls.filter(call => call.options.method === 'POST').map(call => JSON.parse(call.options.body)); }

test('native inventory groups each Skill once and never lists resource paths', async () => {
  const app = harness(); await app.mount();
  const skill = { id: 'native-skill', origin: { root: 'dsh', path: 'skills/example' }, type: 'skill', name: 'example', fileCount: 7, excluded: false, present: true, pendingCloudDelete: false,
    resources: ['references/NEVER-LIST-RESOURCE.md'], files: { 'scripts/NEVER-LIST-SCRIPT.py': 'TEST-CONTENT' } };
  const excluded = { ...trackedPrompt, id: 'excluded', origin: { root: 'agents', path: 'fragments/local.md' }, excluded: true, present: false, pendingCloudDelete: true };
  app.states[state.status] = trackingStatus([trackedPrompt, skill, excluded], true);
  const card = findCard(app, english.assets); assert.ok(card);
  const details = flatten(card).filter(node => node.type === 'details'); assert.equal(details.length, 1); assert.equal(details[0].props.open, undefined);
  assert.equal(flatten(details[0]).filter(node => node.type === 'strong' && node.children.includes('example')).length, 1);
  const display = JSON.stringify(card); assert.ok(display.includes('.dsh/AGENTS.md')); assert.ok(display.includes('.agents/fragments/local.md'));
  assert.ok(display.includes('Resource files: 7')); assert.ok(display.includes(english.trackingExcluded)); assert.ok(display.includes(english.trackingPendingDelete)); assert.ok(display.includes(english.trackingMissing));
  assert.ok(!display.includes('NEVER-LIST-')); assert.ok(!display.includes('TEST-CONTENT'));
  const headings = flatten(app.render()).filter(node => node.type === 'h3').map(node => node.children[0]);
  assert.equal(headings.filter(heading => heading === english.assets).length, 1);
  assert.ok(!headings.includes('Asset library'));
  app.replies.push({ tracking: app.states[state.status].tracking }); app.click(english.trackingRefresh); await flush();
  assert.deepEqual(postBodies(app), [{ action: 'tracking-refresh' }]); app.unmount();
});

test('.agents is off by default and opening or cancelling its warning sends no request', async () => {
  const app = harness(); await app.mount();
  assert.equal(findCheckbox(app, english.trackingAgentsEnabled).props.checked, false);
  findCheckbox(app, english.trackingAgentsEnabled).props.onChange({ target: { checked: true } });
  let tree = app.commit(); assert.equal(app.trackingDialog.open, true); assert.equal(app.dialog.open, false);
  assert.equal(findCheckbox(app, english.trackingAgentsEnabled).props.checked, false, 'Opening the warning must not optimistically enable tracking.');
  assert.ok(JSON.stringify(tree).includes(english.trackingAgentsWarning)); assert.deepEqual(postBodies(app), []);
  app.click(english.cancel); app.commit(); assert.equal(app.trackingDialog.open, false); assert.deepEqual(postBodies(app), []);
  findCheckbox(app, english.trackingAgentsEnabled).props.onChange({ target: { checked: true } });
  tree = app.commit(); const modal = flatten(tree).find(node => node.type === 'dialog');
  let prevented = false; let stopped = false;
  modal.props.onKeyDownCapture({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  app.commit(); assert.equal(prevented && stopped, true); assert.equal(app.trackingDialog.open, false); assert.deepEqual(postBodies(app), []); app.unmount();
});

test('.agents enabling requires explicit overwrite confirmation while disabling does not delete files', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = trackingStatus();
  findCheckbox(app, english.trackingAgentsEnabled).props.onChange({ target: { checked: true } }); app.commit();
  app.replies.push({ configured: true }); app.getReplies.push(app.success(trackingStatus([], true)));
  app.click(english.trackingAgentsConfirm); await flush(); app.commit();
  assert.deepEqual(postBodies(app), [{ action: 'tracking-configure', agentsEnabled: true, confirmOverwrite: true }]);
  assert.equal(findCheckbox(app, english.trackingAgentsEnabled).props.checked, true); assert.equal(app.trackingDialog.open, false);
  assert.ok(JSON.stringify(findCard(app, english.assets)).includes(english.trackingAgentsHelp));
  app.replies.push({ configured: true }); app.getReplies.push(app.success(trackingStatus([], false)));
  findCheckbox(app, english.trackingAgentsEnabled).props.onChange({ target: { checked: false } }); await flush(); app.commit();
  assert.deepEqual(postBodies(app)[1], { action: 'tracking-configure', agentsEnabled: false }); assert.equal(app.trackingDialog.open, false);
  assert.equal(findCheckbox(app, english.trackingAgentsEnabled).props.checked, false); app.unmount();
});

test('exclusion warns about local preservation and cloud removal, with safe cancellation', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = { ...trackingStatus(), encrypted: true, locked: true, signedIn: false };
  assert.equal(app.button(english.trackingExclude).props.disabled, false, 'A locked/offline device may queue cloud deletion.');
  app.click(english.trackingExclude); const tree = app.commit(); const modal = flatten(tree).find(node => node.type === 'dialog');
  assert.equal(app.trackingDialog.open, true); const message = JSON.stringify(modal);
  for (const key of ['trackingExcludeLocal', 'trackingExcludeCloud', 'trackingExcludeRetention']) assert.ok(message.includes(english[key]));
  assert.deepEqual(postBodies(app), []); let canceled = false;
  modal.props.onCancel({ preventDefault() { canceled = true; } }); app.commit();
  assert.equal(canceled, true); assert.equal(app.trackingDialog.open, false); assert.deepEqual(postBodies(app), []); app.unmount();
});

test('confirmed exclusion sends explicit cloud-delete consent and displays pending state; include needs no confirmation', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = trackingStatus();
  app.click(english.trackingExclude); app.commit();
  const excluded = { ...trackedPrompt, excluded: true, pendingCloudDelete: true };
  app.replies.push({ excluded: true, pendingCloudDelete: true }); app.getReplies.push(app.success(trackingStatus([excluded])));
  app.click(english.trackingExcludeConfirm); await flush(); app.commit();
  assert.deepEqual(postBodies(app), [{ action: 'tracking-exclude', id: trackedPrompt.id, confirmCloudDelete: true }]);
  assert.equal(app.trackingDialog.open, false); const inventory = JSON.stringify(findCard(app, english.assets));
  assert.ok(inventory.includes(english.trackingExcluded)); assert.ok(inventory.includes(english.trackingPendingDelete));
  app.replies.push({ included: true }); app.getReplies.push(app.success(trackingStatus())); app.click(english.trackingInclude); await flush();
  assert.deepEqual(postBodies(app)[1], { action: 'tracking-include', id: trackedPrompt.id }); app.unmount();
});

test('a reappeared cloud copy can be explicitly removed while the item stays excluded', async () => {
  const app = harness(); await app.mount();
  const reappeared = { ...trackedPrompt, excluded: true, cloudPresent: true, pendingCloudDelete: false };
  app.states[state.status] = { ...trackingStatus([reappeared]), encrypted: true, locked: true, signedIn: false };
  const inventory = JSON.stringify(findCard(app, english.assets));
  assert.ok(inventory.includes(english.trackingExcluded)); assert.ok(inventory.includes(english.trackingCloudPresent));
  assert.equal(app.button(english.trackingRemoveCloud).props.disabled, false); assert.deepEqual(postBodies(app), []);
  app.click(english.trackingRemoveCloud); const tree = app.commit(); assert.equal(app.trackingDialog.open, true);
  const modal = flatten(tree).find(node => node.type === 'dialog');
  assert.ok(JSON.stringify(modal).includes(english.trackingExcludeLocal));
  assert.ok(JSON.stringify(modal).includes(english.trackingExcludeRetention)); assert.deepEqual(postBodies(app), []);
  app.click(english.cancel); app.commit(); assert.equal(app.trackingDialog.open, false); assert.deepEqual(postBodies(app), []);
  app.click(english.trackingRemoveCloud); app.commit();
  const pending = { ...reappeared, pendingCloudDelete: true };
  app.replies.push({ excluded: true, pendingCloudDelete: true }); app.getReplies.push(app.success(trackingStatus([pending])));
  app.click(english.trackingExcludeConfirm); await flush(); app.commit();
  assert.deepEqual(postBodies(app), [{ action: 'tracking-exclude', id: reappeared.id, confirmCloudDelete: true }]);
  const updated = JSON.stringify(findCard(app, english.assets));
  assert.ok(updated.includes(english.trackingExcluded)); assert.ok(updated.includes(english.trackingPendingDelete));
  assert.ok(!flatten(findCard(app, english.assets)).some(node => node.type === 'button' && node.children.includes(english.trackingRemoveCloud)));
  app.unmount();
});

test('cloud removal is not offered for active, absent, or already-pending items', async () => {
  const app = harness(); await app.mount();
  for (const item of [trackedPrompt, { ...trackedPrompt, excluded: true, cloudPresent: false }, { ...trackedPrompt, excluded: true, cloudPresent: true, pendingCloudDelete: true }]) {
    app.states[state.status] = trackingStatus([item]);
    assert.ok(!flatten(findCard(app, english.assets)).some(node => node.type === 'button' && node.children.includes(english.trackingRemoveCloud)));
  }
  assert.deepEqual(postBodies(app), []); app.unmount();
});

test('one Sync assets card lists each native item once without an internal editor', async () => {
  const app = harness(); await app.mount();
  app.states[state.status] = { ...trackingStatus(), assets: [{ id:trackedPrompt.id,type:'prompt',name:'DUPLICATE-SUMMARY' }] };
  const tree = app.render(); const headings = flatten(tree).filter(node=>node.type==='h3').map(node=>node.children[0]);
  assert.equal(headings.filter(title=>title===english.assets).length,1);
  assert.ok(!JSON.stringify(tree).includes('DUPLICATE-SUMMARY'));
  assert.ok(!flatten(tree).some(node=>node.type==='textarea'));
  assert.equal(flatten(findCard(app,english.assets)).filter(node=>node.type==='strong'&&node.children.includes('.dsh/AGENTS.md')).length,1);
  app.unmount();
});

test('View opens the verified original prompt in its registered Host application even when excluded and locked', async () => {
  const app=harness(); await app.mount();
  app.states[state.status]={...trackingStatus([{...trackedPrompt,excluded:true}]),encrypted:true,locked:true,signedIn:false};
  const path='C:\\fixture\\.dsh\\AGENTS.md'; app.replies.push({path});
  assert.equal(app.button(english.view).props.disabled,false); await app.click(english.view); await flush();
  assert.deepEqual(postBodies(app),[{action:'asset-open',id:trackedPrompt.id}]);
  assert.deepEqual(app.editorCalls,[{method:'available'},{method:'open',request:{path}}]);
  assert.ok(JSON.stringify(app.render()).includes(english.editorOpened));
  assert.ok(!flatten(app.render()).some(node=>node.type==='textarea'));
  assert.equal(app.clipboardWrites.length,0); assert.equal(app.opens.length,0); app.unmount();
});

test('View opens Skill SKILL.md and does not require a synchronized asset cache or initialized vault', async () => {
  const app=harness(); await app.mount();
  const skill={...trackedPrompt,id:'skill',type:'skill',name:'example',origin:{root:'dsh',path:'skills/example'},fileCount:4};
  app.states[state.status]={...trackingStatus([skill]),initialized:false,signedIn:false,assets:[]};
  const path='/fixture/.dsh/skills/example/SKILL.md'; app.replies.push({path}); await app.click(english.view);
  assert.deepEqual(postBodies(app),[{action:'asset-open',id:'skill'}]);
  assert.deepEqual(app.editorCalls.at(-1),{method:'open',request:{path}}); app.unmount();
});

test('missing files and disabled agents are not offered an original-file launcher', async () => {
  const app=harness(); await app.mount();
  const hidden={...trackedPrompt,id:'hidden-agents',origin:{root:'agents',path:'fragments/HIDDEN-FIXTURE.md'}};
  app.states[state.status]=trackingStatus([{...trackedPrompt,present:false},hidden],false);
  const tree=app.render(); assert.ok(!flatten(tree).some(node=>node.type==='button'&&node.children.includes(english.view)));
  assert.ok(!JSON.stringify(tree).includes('HIDDEN-FIXTURE')); assert.ok(!flatten(tree).some(node=>node.type==='h4'&&node.children.includes(english.trackingAgentsRoot)));
  assert.deepEqual(postBodies(app),[]); app.unmount();
});

test('editor capability and open failures are explicit and never fall back to content reads or another viewer', async () => {
  for (const mode of ['missing','unavailable','capability-failed','open-failed','missing-ack','invalid-path']) {
    const app=harness(); await app.mount(); app.states[state.status]=trackingStatus();
    app.replies.push({path:mode==='invalid-path'?'javascript:invalid':'/fixture/.dsh/AGENTS.md'});
    if(mode==='missing') delete app.remote.session.openWorkspacePath;
    if(mode==='unavailable') app.availabilityReplies.push({ok:true,value:false});
    if(mode==='capability-failed') app.availabilityReplies.push(new Error('PRIVATE-CAPABILITY-FIXTURE'));
    if(mode==='open-failed') app.openReplies.push({ok:false,error:{message:'PRIVATE-OPEN-FIXTURE'}});
    if(mode==='missing-ack') app.openReplies.push({ok:true,value:{opened:false}});
    await app.click(english.view); await flush();
    const expected=mode==='invalid-path'?english.editorInvalidPath:['open-failed','missing-ack'].includes(mode)?english.editorOpenFailed:english.editorUnavailable;
    assert.ok(flatten(app.render()).some(node=>node.props.role==='alert'&&node.children.includes(expected)),mode);
    assert.ok(!JSON.stringify(app.render()).includes('PRIVATE-'));
    assert.deepEqual(postBodies(app),[{action:'asset-open',id:trackedPrompt.id}]);
    assert.ok(!flatten(app.render()).some(node=>node.type==='textarea')); assert.equal(app.opens.length,0); app.unmount();
  }
});

test('unmount during editor availability never opens a late native application', async () => {
  const app=harness(); await app.mount(); app.states[state.status]=trackingStatus(); app.replies.push({path:'/fixture/.dsh/AGENTS.md'});
  const pending=deferred(); app.availabilityReplies.push(()=>pending.promise); const opening=app.click(english.view); await flush();
  assert.equal(app.editorCalls.length,1); app.unmount(); pending.resolve({ok:true,value:true}); await opening;
  assert.deepEqual(app.editorCalls,[{method:'available'}]);
});

test('all cancellable confirmation modals use equal side-by-side buttons with uniform mobile rows', async () => {
  assert.match(source,/\.ds-dialog-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source,/\.ds-dialog-actions>button\{[^}]*width:100%;height:100%;min-height:44px/);
  assert.match(source,/\.ds-dialog-actions\{grid-template-columns:1fr;grid-auto-rows:1fr\}/);
  assert.doesNotMatch(source,/\.ds-recovery-dialog\s+\.ds-primary/);
  for(const kind of ['agents','exclude','restore']) {
    const app=harness(); await app.mount(); app.states[state.status]={...trackingStatus(),backups:[{id:'backup',side:'local'}]};
    if(kind==='agents') findCheckbox(app,english.trackingAgentsEnabled).props.onChange({target:{checked:true}});
    else app.click(kind==='exclude'?english.trackingExclude:english.restore);
    const modal=flatten(app.commit()).find(node=>node.type==='dialog'); assert.ok(modal);
    assert.ok(!modal.props.className.includes('ds-recovery-dialog'));
    const group=flatten(modal).find(node=>node.props.className==='ds-dialog-actions'); assert.ok(group);
    const buttons=group.children.filter(node=>node?.type==='button'); assert.equal(buttons.length,2); assert.equal(buttons[0].children[0],english.cancel);
    assert.ok(buttons.every(node=>!node.props.className?.includes('ds-recovery-confirm'))); app.unmount();
  }
});

test('device trust preference is a user action and reflects protected cache setup', async () => {
  const app=harness(); await app.mount();
  const trusted={...base,encrypted:true,locked:true,deviceTrust:{available:true,provider:'fixture-os',remember:true,manualLocked:false,hasSavedKey:false}};
  app.states[state.status]=trusted; assert.equal(findCheckbox(app,english.deviceTrustRemember).props.checked,true);
  assert.ok(JSON.stringify(app.render()).includes(english.deviceTrustEstablish));
  app.replies.push({remember:false}); app.getReplies.push(app.success({...trusted,deviceTrust:{...trusted.deviceTrust,remember:false}}));
  findCheckbox(app,english.deviceTrustRemember).props.onChange({target:{checked:false}}); await flush();
  assert.deepEqual(postBodies(app),[{action:'device-trust-configure',remember:false}]);
  assert.equal(findCheckbox(app,english.deviceTrustRemember).props.checked,false);
  app.replies.push({remember:true}); app.getReplies.push(app.success(trusted));
  findCheckbox(app,english.deviceTrustRemember).props.onChange({target:{checked:true}}); await flush();
  assert.deepEqual(postBodies(app)[1],{action:'device-trust-configure',remember:true}); app.unmount();
});

test('unavailable device protection disables trust without showing raw provider output', async () => {
  for(const deviceTrust of [undefined,{available:false,remember:true,error:'PRIVATE-PROTECTOR-OUTPUT'}]) {
    const app=harness(); await app.mount(); app.states[state.status]={...base,deviceTrust};
    const checkbox=findCheckbox(app,english.deviceTrustRemember); assert.equal(checkbox.props.disabled,true); assert.equal(checkbox.props.checked,false);
    const display=JSON.stringify(app.render()); assert.ok(display.includes(english.deviceTrustUnavailable)); assert.ok(!display.includes('PRIVATE-PROTECTOR-OUTPUT'));
    assert.deepEqual(postBodies(app),[]); app.unmount();
  }
});

test('manual lock remains visible and the UI never implicitly grants unlock or agents access', async () => {
  const app=harness(); app.getReplies.push(app.success({...base,encrypted:true,locked:true,deviceTrust:{available:true,remember:true,manualLocked:true,hasSavedKey:false}})); await app.mount();
  const display=JSON.stringify(app.render()); assert.ok(display.includes(english.deviceTrustManualLock)); assert.ok(!display.includes(english.deviceTrustEstablish));
  assert.deepEqual(postBodies(app),[]); assert.equal(findCheckbox(app,english.trackingAgentsEnabled).props.checked,false); app.unmount();
});

test('backup restoration uses the same cancellable modal and preserves its exact API payload', async () => {
  const app=harness(); await app.mount(); app.states[state.status]={...base,backups:[{id:'backup-fixture',side:'local'}]};
  app.click(english.restore); app.commit(); app.click(english.cancel); app.commit(); assert.deepEqual(postBodies(app),[]);
  app.click(english.restore); app.commit(); app.replies.push({restored:true}); app.click(english.confirmRestore); await flush(); app.commit();
  assert.deepEqual(postBodies(app),[{action:'backup-restore',id:'backup-fixture'}]); assert.equal(app.trackingDialog.open,false); app.unmount();
});

test('one-time recovery modal takes priority over tracking confirmation without losing the key', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = trackingStatus();
  app.click(english.trackingExclude); app.commit(); assert.equal(app.trackingDialog.open, true);
  app.states[state.recovery] = 'RECOVERY-PRIORITY-FIXTURE';
  const tree = app.commit(); assert.equal(app.dialog.open, true); assert.equal(app.trackingDialog.open, false);
  assert.equal(flatten(tree).filter(node => node.type === 'dialog').length, 1); assert.equal(app.states[state.recovery], 'RECOVERY-PRIORITY-FIXTURE');
  assert.deepEqual(postBodies(app), []); app.unmount();
});

test('deletion conflict choices carry exact version hashes and stale choices stay disabled', async () => {
  const app = harness(); await app.mount();
  const conflict = { id: 'a', name: 'Example', type: 'prompt', localHash: null, remoteHash: 'hash', localDeleted: true, remoteDeleted: false };
  app.states[state.status] = { ...base, conflicts: [conflict] };
  assert.equal(app.button('Apply choices and sync').props.disabled, true);
  const selector = flatten(app.render()).find(node => node.type === 'select' && node.children.some(child => child?.children?.includes('Local — Deleted')));
  assert.ok(selector); selector.props.onChange({ target: { value: 'remote' } });
  app.states[state.status] = { ...base, conflicts: [{ ...conflict, remoteHash: 'changed' }] };
  assert.equal(app.button('Apply choices and sync').props.disabled, true);
  app.states[state.status] = { ...base, conflicts: [conflict] };
  app.replies.push({ synced: true }); app.click('Apply choices and sync'); await flush();
  const call = app.calls.find(item => item.options.body);
  assert.deepEqual(JSON.parse(call.options.body), { action: 'sync', decisions: { a: { side: 'remote', localHash: null, remoteHash: 'hash' } } });
  for (const request of app.calls) {
    assert.equal(request.url, '/api/dsh-sync'); assert.equal(request.options.credentials, 'same-origin'); assert.equal(request.options.cache, 'no-store');
  }
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  app.unmount();
});

test('sign-in opens the validated HTTPS address without an intermediate blank tab', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = { ...base, signedIn: false };
  app.replies.push({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=example' });
  app.click('Sign in with Microsoft'); assert.equal(app.opens.length, 0);
  await flush(); assert.equal(app.opens.length, 1); assert.equal(app.tabs[0].opener, null);
  app.unmount(); assert.equal(app.tabs[0].closed, false);
});

test('sign-in failures and untrusted redirects never open an external address', async () => {
  for (const reply of [new Error('Sign-in failed'), { url: 'https://example.com/login' }, { url: 'https://login.microsoftonline.com@evil.example/login' }]) {
    const app = harness(); await app.mount(); app.states[state.status] = { ...base, signedIn: false };
    app.replies.push(reply); app.click('Sign in with Microsoft'); await flush();
    assert.equal(app.opens.length, 0); assert.ok(flatten(app.render()).some(node => node.props.role === 'alert'));
    assert.equal(flatten(app.render()).filter(node => node.type === 'a').length, 0);
    app.unmount();
  }
});

test('unmount aborts sign-in and never opens a late authorization response', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = { ...base, signedIn: false };
  const pending = deferred(); app.replies.push(() => pending.promise);
  app.click('Sign in with Microsoft');
  const request = app.calls.at(-1);
  app.unmount();
  assert.equal(app.opens.length, 0); assert.equal(request.options.signal.aborted, true);
  assert.equal(app.events.size, 0); assert.equal(app.timers.size, 0);
  pending.resolve(app.success({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' }));
  await flush(); assert.equal(app.opens.length, 0);
});

test('non-JSON status responses show safe HTTP diagnostics and Refresh recovers cleanly', async () => {
  for (const status of [200, 401, 404, 500]) {
    const app = harness();
    app.getReplies.push(new Response('<html>PRIVATE-RESPONSE-FIXTURE</html>', { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    await app.mount();
    const alerts = flatten(app.render()).filter(node => node.props.role === 'alert');
    assert.ok(alerts.some(node => node.children.some(value => typeof value === 'string' && value.includes(`HTTP ${status}`) && value.includes('text/html'))));
    assert.ok(!JSON.stringify(app.render()).includes('PRIVATE-RESPONSE-FIXTURE'));
    assert.ok(!flatten(app.render()).some(node => node.children.includes('Loading sync settings…')));
    await app.click('Refresh'); await flush();
    assert.equal(flatten(app.render()).filter(node => node.props.role === 'alert').length, 0);
    assert.ok(flatten(app.render()).some(node => node.children.includes('Microsoft account')));
    app.unmount();
  }
});

test('successful status refresh does not erase a user-operation failure', async () => {
  const app = harness(); await app.mount();
  app.replies.push(() => new Response('PRIVATE-OPERATION-FIXTURE', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
  app.click('Sync now'); await flush();
  assert.ok(flatten(app.render()).some(node => node.props.role === 'alert' && node.children.some(value => typeof value === 'string' && value.includes('HTTP 503'))));
  assert.ok(!JSON.stringify(app.render()).includes('PRIVATE-OPERATION-FIXTURE'));
  app.unmount();
});

test('desktop null handles and browser popup failures preserve a usable sign-in link', async () => {
  for (const mode of ['desktopExternal', 'blockPopup', 'throwOnOpen']) {
    const app = harness(); await app.mount(); app.states[state.status] = { ...base, signedIn: false }; app[mode]();
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=example';
    app.replies.push({ url }); app.getReplies.push(app.success({ ...base, signedIn: false, auth: { pending: true } }));
    app.click('Sign in with Microsoft'); await flush();
    assert.equal(app.calls.filter(call => call.options.method === 'POST').length, 1);
    assert.equal(app.opens.length, 1); assert.equal(app.opens[0], url);
    assert.equal(flatten(app.render()).filter(node => node.props.role === 'alert').length, 0);
    const link = flatten(app.render()).find(node => node.type === 'a' && node.children.includes('Open Microsoft sign-in'));
    assert.ok(link); assert.equal(link.props.href, url); assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer');
    app.unmount();
  }
});

const localeFiles = Object.fromEntries(['en', 'zh-CN', 'ja'].map(language => [language, JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))]));

for (const language of Object.keys(localeFiles)) {
  test(`${language} resources are complete and render safety dialogs in the Host language`, async () => {
    const app = harness(language); await app.mount();
    const { meta, ...messages } = localeFiles[language];
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(app.dictionary).sort());
    for (const [key, value] of Object.entries(messages)) assert.equal(app.dictionaries[language][key], value);
    app.states[state.recovery] = 'FIXTURE-KEY'; app.commit();
    let tree = JSON.stringify(app.render());
    for (const key of ['recoveryOnce', 'recoveryWarning', 'recoverySaved']) assert.ok(tree.includes(messages[key]));
    app.states[state.recovery] = '';
    app.states[state.confirm] = { kind: 'tracking-exclude', id: 'fixture', origin: { root: 'dsh', path: 'AGENTS.md' } };
    tree = JSON.stringify(app.render());
    for (const key of ['trackingExcludeLocal', 'trackingExcludeCloud', 'trackingExcludeRetention']) assert.ok(tree.includes(messages[key]));
    assert.ok(!flatten(app.render()).some(node => node.type === 'select' && node.props.value === language));
    app.unmount(); assert.equal(app.localeListeners.size, 0);
    app.disposePlugin(); assert.equal(Object.keys(app.dictionaries).length, 0);
  });
}

test('Chinese aliases resolve without a plugin language preference and missing translations fall back to English', () => {
  const app = harness();
  for (const language of ['zh', 'zh-Hans']) assert.equal(app.dictionaries[language].loading, localeFiles['zh-CN'].loading);
  assert.deepEqual(Object.keys(app.dictionaries).sort(), ['en', 'ja', 'zh', 'zh-CN', 'zh-Hans'].sort());
  for (const language of ['zh-TW', 'zh-Hant', 'zh-HK']) {
    app.switchLanguage(language);
    assert.ok(JSON.stringify(app.render()).includes(english.loading));
  }
  app.switchLanguage('ja'); delete app.dictionaries.ja.loading;
  assert.ok(JSON.stringify(app.render()).includes(english.loading));
  assert.deepEqual(JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')), localeFiles['zh-CN']);
  app.disposePlugin();
});

test('Host switches update text, dates, existing notices and validation without changing operation state', async () => {
  const app = harness('zh'); await app.mount();
  const stamp = '2026-11-07T12:00:00Z';
  app.states[state.status] = { ...base, lastSync: stamp };
  assert.ok(JSON.stringify(app.render()).includes(localeFiles['zh-CN'].sync));
  app.replies.push({}); app.click(localeFiles['zh-CN'].sync); await flush();
  app.states[state.status] = { ...base, lastSync: stamp };
  app.states[state.passphrase] = 'FIXTURE-UNFINISHED-SECRET';
  for (const language of ['zh-CN', 'ja', 'en']) {
    app.switchLanguage(language);
    const tree = JSON.stringify(app.render());
    assert.ok(tree.includes(localeFiles[language].done));
    assert.ok(tree.includes(new Date(stamp).toLocaleString(language)));
    assert.equal(app.states[state.passphrase], 'FIXTURE-UNFINISHED-SECRET');
    assert.ok(app.localeNotifications > 0);
  }
  app.states[state.passphrase] = ''; app.click(english.enableEncryption);
  app.switchLanguage('ja');
  assert.ok(JSON.stringify(app.render()).includes(localeFiles.ja.passphraseRequired));
  app.switchLanguage('fr'); assert.ok(JSON.stringify(app.render()).includes(english.sync));
  assert.equal(app.calls.filter(call => call.options.method === 'POST').length, 1);
  app.unmount();
});

test('language switching preserves modal identity, acknowledgement and fingerprint-bound choices', async () => {
  const app = harness(); await app.mount();
  const choice = { side: 'local', localHash: 'fixture-local', remoteHash: 'fixture-remote' };
  app.states[state.choices] = { fixture: choice };
  app.states[state.recovery] = 'FIXTURE-RECOVERY'; app.states[state.savedRecovery] = true;
  app.commit(); const opened = app.dialog.showModalCalls;
  app.switchLanguage('ja'); app.commit();
  assert.ok(JSON.stringify(app.render()).includes(localeFiles.ja.recoveryWarning));
  assert.equal(app.dialog.open, true); assert.equal(app.dialog.showModalCalls, opened);
  assert.equal(app.states[state.savedRecovery], true); assert.equal(app.states[state.recovery], 'FIXTURE-RECOVERY');
  assert.equal(app.states[state.choices].fixture, choice);
  app.states[state.recovery] = '';
  const confirmation = { kind: 'restore', id: 'fixture-backup' };
  app.states[state.confirm] = confirmation; app.commit(); const trackingOpened = app.trackingDialog.showModalCalls;
  app.switchLanguage('zh'); app.commit();
  assert.ok(JSON.stringify(app.render()).includes(localeFiles['zh-CN'].restoreConfirm));
  assert.equal(app.trackingDialog.open, true); assert.equal(app.trackingDialog.showModalCalls, trackingOpened);
  assert.equal(app.states[state.confirm], confirmation); assert.equal(app.calls.filter(call => call.options.method === 'POST').length, 0);
  app.unmount();
});

test('known request, status and scan error codes translate live while unknown diagnostics remain bounded and redacted', async () => {
  const app = harness('zh-CN'); await app.mount();
  app.replies.push(() => ({ ok: false, json: async () => ({ ok: false, error: { code: 'locked', message: 'PRIVATE-KNOWN-DETAIL' } }) }));
  app.click(localeFiles['zh-CN'].sync); await flush();
  assert.ok(JSON.stringify(app.render()).includes(localeFiles['zh-CN']['error_locked']));
  assert.ok(!JSON.stringify(app.render()).includes('PRIVATE-KNOWN-DETAIL'));
  app.switchLanguage('ja'); assert.ok(JSON.stringify(app.render()).includes(localeFiles.ja.error_locked));
  app.states[state.error] = '';
  app.states[state.status] = { ...trackingStatus(), error: { code: 'network-failed', message: 'PRIVATE-NETWORK' }, auth: { error: { code: 'authorization-timeout', message: 'PRIVATE-AUTH' } } };
  app.states[state.status].tracking.issues = [{ code: 'native-linked-path', message: 'PRIVATE-SCAN', origin: { root: 'dsh', path: 'skills/example' } }];
  const tree = JSON.stringify(app.render());
  for (const code of ['network-failed', 'authorization-timeout', 'native-linked-path']) assert.ok(tree.includes(localeFiles.ja[`error_${code}`]));
  assert.ok(tree.includes('.dsh/skills/example')); assert.ok(!tree.includes('PRIVATE-'));
  app.states[state.secret] = 'FIXTURE-SECRET';
  app.states[state.status] = { ...base, encrypted: true, locked: true };
  app.replies.push(() => ({ ok: false, json: async () => ({ ok: false, error: { code: 'UnknownGraphCode', message: 'UnknownGraphCode FIXTURE-SECRET ' + 'x'.repeat(800) } }) }));
  app.click(localeFiles.ja.unlock); await flush();
  const alert = flatten(app.render()).find(node => node.props.role === 'alert');
  assert.ok(alert.children[0].includes('UnknownGraphCode [redacted]')); assert.ok(alert.children[0].length <= 600);
  assert.ok(!JSON.stringify(app.states[state.error]).includes('FIXTURE-SECRET'));
  app.switchLanguage('zh');
  assert.ok(JSON.stringify(app.render()).includes('UnknownGraphCode [redacted]'));
  app.unmount();
});

test('expired authorization removes the stale fallback link', async () => {
  const app = harness(); await app.mount(); app.states[state.status] = { ...base, signedIn: false }; app.desktopExternal();
  app.replies.push({ url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' });
  app.getReplies.push(app.success({ ...base, signedIn: false, auth: { pending: true } }));
  app.click('Sign in with Microsoft'); await flush();
  assert.equal(flatten(app.render()).filter(node => node.type === 'a').length, 1);
  app.getReplies.push(app.success({ ...base, signedIn: false, auth: { pending: false, error: { message: 'Login expired.' } } }));
  await app.events.get('focus')(); await flush();
  assert.equal(flatten(app.render()).filter(node => node.type === 'a').length, 0);
  app.unmount();
});

for (const [action, label, status] of [
  ['enable-encryption', 'Enable encryption', base],
  ['change-passphrase', 'Change passphrase', { ...base, encrypted: true, locked: false }],
]) {
  for (const failure of ['encryption-local-failed', 'device-cache-failed']) {
    test(`${action} shows remote success and ${failure} inside the recovery modal even when refresh fails`, async () => {
      const app = harness(); await app.mount(); app.states[state.status] = status;
      app.states[state.passphrase] = 'A long fixture passphrase'; app.states[state.confirmation] = 'A long fixture passphrase';
      app.replies.push({ recoveryKey: 'FIXTURE-PARTIAL-RECOVERY-KEY', remotePublished: true, localCompleted: false,
        error: { code: failure, message: 'Fixture diagnostic must not replace the explicit outcome.' } });
      app.getReplies.push(new Error('Fixture local store is unavailable.'));
      app.click(label); await flush();
      const tree = app.commit(); const modal = flatten(tree).find(node => node.type === 'dialog');
      assert.ok(modal); assert.equal(app.dialog.open, true);
      assert.ok(flatten(modal).some(node => node.type === 'code' && node.children.includes('FIXTURE-PARTIAL-RECOVERY-KEY')));
      assert.ok(flatten(modal).some(node => node.props.role === 'alert' && node.children.includes(english.encryptionPublishedLocalFailed)));
      assert.equal(app.states[state.notice], '', 'Partial completion must not say Done.');
      assert.ok(!JSON.stringify(tree).includes('Fixture diagnostic'));
      assert.equal(app.button(english.recoveryConfirm).props.disabled, true);
      assert.equal(app.states[state.passphrase], ''); assert.equal(app.states[state.confirmation], '');
      await app.click(english.recoveryCopy); assert.deepEqual(app.clipboardWrites, ['FIXTURE-PARTIAL-RECOVERY-KEY']);
      app.states[state.savedRecovery] = true; app.click(english.recoveryConfirm); app.commit();
      assert.equal(app.dialog.open, false); assert.equal(app.states[state.recovery], '');
      assert.ok(flatten(app.render()).some(node => node.props.role === 'alert' && node.children.includes(english.encryptionPublishedLocalFailed)));
      assert.ok(!JSON.stringify(app.render()).includes('FIXTURE-PARTIAL-RECOVERY-KEY'));
      app.unmount();
    });
  }
}
