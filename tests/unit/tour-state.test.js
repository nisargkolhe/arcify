import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceTour, TOUR_STEPS, registerTourMessages, TOUR_KEY } from '../../tour-state.js';
const start = (step = 0, runId = 'first') => reduceTour(undefined, { action: 'start', windowId: 7, step, runId });
test('tour ignores stale and repeated next events, preserving the current step', () => {
    const state = start();
    const next = reduceTour(state, { action: 'next', runId: 'first', step: 0 });
    assert.equal(next.step, 1);
    assert.equal(reduceTour(next, { action: 'next', runId: 'first', step: 0 }), next);
    assert.equal(reduceTour(next, { action: 'next', runId: 'old', step: 1 }), next);
});
test('skipped and finished tours cannot be revived by delayed achievements', () => {
    for (const state of [reduceTour(start(), { action: 'stop', runId: 'first' }),
        reduceTour(start(TOUR_STEPS.length - 1), { action: 'finish', runId: 'first', step: TOUR_STEPS.length - 1 })]) {
        assert.notEqual(state.status, 'active');
        assert.equal(reduceTour(state, { action: 'achieved', runId: 'first', step: state.step }), state);
    }
    assert.equal(start(0, 'replay').status, 'active');
});
test('the graduation CTA only finishes from the final step', () => {
    const finalStep = TOUR_STEPS.length - 1;
    assert.equal(reduceTour(start(finalStep), { action: 'finish', runId: 'first', step: finalStep }).status, 'completed');
    assert.equal(reduceTour(start(finalStep - 1), { action: 'finish', runId: 'first', step: finalStep - 1 }).status, 'active');
});
test('only observed achievements mark a feature tried; revisiting does not duplicate it', () => {
    let state = reduceTour(start(), { action: 'achieved', runId: 'first', step: 0 });
    state = reduceTour(state, { action: 'go', runId: 'first', step: 0 });
    state = reduceTour(state, { action: 'achieved', runId: 'first', step: 0 });
    assert.deepEqual(state.completed, ['spaces']);
    assert.equal(start(-10).step, 0);
    assert.equal(start(100).step, TOUR_STEPS.length - 1);
});
test('background serializes competing sidebar and page events without stealing unrelated messages', async () => {
    let listener; const local = {}; const sync = {};
    globalThis.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } }, getManifest: () => ({ version: '5.1.0' }) }, storage: {
        local: { async get() { return { ...local }; }, async set(data) { Object.assign(local, data); } },
        sync: { async set(data) { Object.assign(sync, data); } }
    } };
    registerTourMessages();
    assert.equal(listener({ type: 'spaceStore' }, {}, () => assert.fail('stole response')), undefined);
    const send = message => new Promise(resolve => {
        assert.equal(listener({ type: 'sidebarTour', ...message }, {}, resolve), true);
    });
    await send({ action: 'start', runId: 'a', windowId: 7, step: 0 });
    await Promise.all([send({ action: 'next', runId: 'a', step: 0 }), send({ action: 'achieved', runId: 'a', step: 0 })]);
    assert.equal(local[TOUR_KEY].step, 1);
    await send({ action: 'stop', runId: 'a' });
    assert.equal(sync.onboardingCompleted, true);
    assert.equal(sync.onboardingVersion, '5.1.0');
    delete globalThis.chrome;
});
test('adding the color lesson preserves the meaning of saved legacy progress', async () => {
    const { normalizeTour } = await import('../../tour-state.js');
    const legacy = { status: 'active', step: 1, runId: 'old', windowId: 7, completed: ['spaces'] };
    const updated = normalizeTour(legacy);
    assert.equal(TOUR_STEPS[updated.step].id, 'pins');
    assert.equal(updated.version, 4);
    assert.equal(normalizeTour(updated), updated);
    assert.equal(TOUR_STEPS[reduceTour(start(), { action: 'next', runId: 'first', step: 0 }).step].id, 'color');
});


test('the split lesson preserves every version 3 tour position', async () => {
    const { normalizeTour } = await import('../../tour-state.js');
    const previousIds = ['spaces', 'color', 'pins', 'folders', 'favorites', 'archive', 'settings', 'done'];
    for (const [step, id] of previousIds.entries()) {
        const saved = { version: 3, status: 'active', step, runId: 'old', windowId: 7, completed: ['pins'] };
        const migrated = normalizeTour(saved);
        assert.equal(migrated.version, 4);
        assert.equal(TOUR_STEPS[migrated.step].id, id);
        assert.deepEqual(migrated.completed, ['pins']);
    }
});

test('navigation continues while practice creation is delayed and keeps its late result', async () => {
    let listener, releaseCreate, notifyCreate;
    const creating = new Promise(resolve => { notifyCreate = resolve; });
    const local = {}, tabs = [];
    globalThis.chrome = {
        runtime: { onMessage: { addListener(fn) { listener = fn; } }, getManifest: () => ({ version: '5.2.0' }), getURL: path => `chrome-extension://test/${path}` },
        storage: { local: { async get() { return { ...local }; }, async set(value) { Object.assign(local, value); } }, sync: { async set() {} } },
        tabs: { async query() { return tabs; }, async create(options) { notifyCreate(); await new Promise(resolve => { releaseCreate = resolve; }); const tab = { id: 42, ...options }; tabs.push(tab); return tab; }, async remove() {} }
    };
    registerTourMessages();
    const send = message => new Promise(resolve => listener({ type: 'sidebarTour', ...message }, {}, resolve));
    const pins = TOUR_STEPS.findIndex(step => step.id === 'pins');
    await send({ action: 'start', runId: 'slow', windowId: 7, step: pins });
    const practice = send({ action: 'practice', runId: 'slow', step: pins });
    await creating;
    const next = await Promise.race([
        send({ action: 'next', runId: 'slow', step: pins }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation was blocked by practice setup')), 250))
    ]);
    assert.equal(next.state.step, pins + 1);
    const back = await send({ action: 'go', runId: 'slow', step: pins });
    assert.equal(back.state.step, pins);
    releaseCreate();
    await practice;
    assert.equal(local[TOUR_KEY].step, pins);
    assert.equal(local[TOUR_KEY].practiceTabs.pins, 42);
    delete globalThis.chrome;
});

test('practice tabs created after finishing are cleaned up without reviving the tour', async () => {
    let listener, releaseCreate, notifyCreate;
    const creating = new Promise(resolve => { notifyCreate = resolve; });
    const local = {}, tabs = [], removed = [];
    globalThis.chrome = {
        runtime: { onMessage: { addListener(fn) { listener = fn; } }, getManifest: () => ({ version: '5.2.0' }), getURL: path => `chrome-extension://test/${path}` },
        storage: { local: { async get() { return { ...local }; }, async set(value) { Object.assign(local, value); } }, sync: { async set() {} } },
        tabs: { async query() { return tabs; }, async create(options) { notifyCreate(); await new Promise(resolve => { releaseCreate = resolve; }); const tab = { id: 43, ...options }; tabs.push(tab); return tab; }, async remove(id) { removed.push(id); } }
    };
    registerTourMessages();
    const send = message => new Promise(resolve => listener({ type: 'sidebarTour', ...message }, {}, resolve));
    const pins = TOUR_STEPS.findIndex(step => step.id === 'pins');
    const finalStep = TOUR_STEPS.length - 1;
    await send({ action: 'start', runId: 'finish-slow', windowId: 7, step: pins });
    const practice = send({ action: 'practice', runId: 'finish-slow', step: pins });
    await creating;
    await send({ action: 'go', runId: 'finish-slow', step: finalStep });
    await send({ action: 'finish', runId: 'finish-slow', step: finalStep });
    releaseCreate();
    await practice;
    assert.equal(local[TOUR_KEY].status, 'completed');
    assert.deepEqual(removed, [43]);
    delete globalThis.chrome;
});
