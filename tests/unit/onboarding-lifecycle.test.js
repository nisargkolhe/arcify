import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../background.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/gm, '');
function background(completed = false) {
    const installed = [], messages = [], opened = [];
    const event = { addListener() {} };
    const chrome = {
        runtime: {
            onInstalled: { addListener: listener => installed.push(listener) },
            onMessage: { addListener: listener => messages.push(listener) },
            onStartup: event
        },
        sidePanel: { setPanelBehavior: async () => {} },
        commands: { onCommand: event },
        alarms: { onAlarm: event, clear: async () => {} },
        storage: { onChanged: event, sync: { get: async () => ({ onboardingCompleted: completed }) } },
        tabs: { create: async tab => opened.push(tab), onActivated: event, onUpdated: event, onRemoved: event }
    };
    runInNewContext(source, {
        chrome, console, registerTourMessages() {},
        SpaceStore: class { install() {} async dispatch() { return [{ id: 'home' }]; } },
        Utils: { getSettings: async () => ({ autoArchiveEnabled: false }) },
        Logger: { log() {}, error() {} }
    });
    return { installed, messages, opened };
}

test('a fresh install opens the onboarding guide once', async () => {
    const app = background();
    await Promise.all(app.installed.map(listener => listener({ reason: 'install' })));
    assert.equal(app.opened.length, 1);
    assert.equal(app.opened[0].url, 'installation-onboarding.html');
    assert.equal(app.opened[0].active, true);
});

test('updates and previously completed or skipped setup do not reopen onboarding', async () => {
    for (const [reason, completed] of [['update', false], ['update', true], ['install', true]]) {
        const app = background(completed);
        await Promise.all(app.installed.map(listener => listener({ reason })));
        assert.equal(app.opened.length, 0);
    }
});

test('space-store replies are not intercepted by unrelated Promise listeners', async () => {
    const app = background();
    const replies = [];
    const claims = app.messages.map(listener => listener({ type: 'spaceStore', action: 'get' }, {}, reply => replies.push(reply)));
    assert.equal(claims.filter(claim => claim === true).length, 1);
    assert.equal(claims.some(claim => typeof claim?.then === 'function'), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].success, true);
    assert.equal(replies[0].spaces[0].id, 'home');
});
