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
        reduceTour(start(TOUR_STEPS.length - 1), { action: 'next', runId: 'first', step: TOUR_STEPS.length - 1 })]) {
        assert.notEqual(state.status, 'active');
        assert.equal(reduceTour(state, { action: 'achieved', runId: 'first', step: state.step }), state);
    }
    assert.equal(start(0, 'replay').status, 'active');
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
    globalThis.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } }, storage: {
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
    delete globalThis.chrome;
});
test('adding the color lesson preserves the meaning of saved legacy progress', async () => {
    const { normalizeTour } = await import('../../tour-state.js');
    const legacy = { status: 'active', step: 1, runId: 'old', windowId: 7, completed: ['spaces'] };
    const updated = normalizeTour(legacy);
    assert.equal(TOUR_STEPS[updated.step].id, 'pins');
    assert.equal(updated.version, 3);
    assert.equal(normalizeTour(updated), updated);
    assert.equal(TOUR_STEPS[reduceTour(start(), { action: 'next', runId: 'first', step: 0 }).step].id, 'color');
});
