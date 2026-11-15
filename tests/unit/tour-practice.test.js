import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupPracticeTabs, preparePractice, isPracticeUrl, practiceUrl } from '../../tour-practice.js';
import { TOUR_STEPS } from '../../tour-state.js';
const base = 'chrome-extension://arcify/';
function mockTabs() {
    const tabs = [], created = [];
    globalThis.chrome = { runtime: { getURL: path => base + path }, tabs: {
        async createSplit() {},
        async query({ windowId }) { return tabs.filter(tab => tab.windowId === windowId); },
        async create(options) { created.push(options); const tab = { ...options, id: tabs.length + 1 }; tabs.push(tab); return tab; }
    } };
    return { tabs, created };
}
const state = step => ({ version: 4, status: 'active', runId: 'test', windowId: 7, step });
test('practice tabs are inactive, per lesson, and reused across panel reopen', async () => {
    const { created } = mockTabs();
    for (const step of TOUR_STEPS.map((step, index) => ['pins', 'folders', 'favorites', 'archive'].includes(step.id) ? index : -1).filter(index => index >= 0)) {
        const before = state(step), message = { runId: 'test', step };
        const first = await preparePractice(before, message, TOUR_STEPS);
        const reopened = await preparePractice(first, message, TOUR_STEPS);
        assert.deepEqual(first.practiceTabs, reopened.practiceTabs);
    }
    assert.equal(created.length, 4);
    assert.ok(created.every(tab => tab.active === false && tab.windowId === 7));
    assert.equal(new Set(created.map(tab => tab.url)).size, 4);
});
test('late practice requests cannot create tabs after skip or a step change', async () => {
    const { created } = mockTabs();
    for (const previous of [{ ...state(1), status: 'skipped' }, state(2), { ...state(1), runId: 'new' }, state(0)]) {
        await preparePractice(previous, { runId: 'test', step: 1 }, TOUR_STEPS);
    }
    assert.equal(created.length, 0);
});
test('practice URL exception excludes all other extension pages and lookalike paths', () => {
    mockTabs();
    assert.ok(isPracticeUrl(practiceUrl('test', 'pins')));
    assert.equal(isPracticeUrl(base + 'installation-onboarding.html'), false);
    assert.equal(isPracticeUrl(base + 'tutorial-practice.html.evil'), false);
    assert.equal(isPracticeUrl('https://example.com/tutorial-practice.html'), false);
});
test('a navigated practice tab is preserved and replaced for the lesson', async () => {
    const { tabs, created } = mockTabs();
    const first = await preparePractice(state(2), { runId: 'test', step: 2 }, TOUR_STEPS);
    tabs[0].url = 'https://example.com/real-work';
    const second = await preparePractice(first, { runId: 'test', step: 2 }, TOUR_STEPS);
    assert.equal(created.length, 2);
    assert.notEqual(first.practiceTabs.pins, second.practiceTabs.pins);
    assert.equal(tabs[0].url, 'https://example.com/real-work');
});
test('bookmark matching keeps practice lessons and runs distinct', async () => {
    mockTabs();
    const { Utils } = await import('../../utils.js');
    const urls = [practiceUrl('first', 'pins'), practiceUrl('first', 'folders'), practiceUrl('second', 'pins')];
    assert.equal(new Set(urls.map(url => Utils.getPinnedUrlKey(url))).size, 3);
    assert.equal(Utils.getPinnedUrlKey('https://example.com/read?x=1#part'), 'https://example.com/read');
});
test('finishing cleanup closes only untouched practice tabs', async () => {
    const { tabs } = mockTabs();
    tabs.push({ id: 9, windowId: 7, url: practiceUrl('test', 'pins') });
    tabs.push({ id: 10, windowId: 7, url: 'https://example.com/real-work' });
    const removed = [];
    chrome.tabs.remove = async id => removed.push(id);
    const closed = await cleanupPracticeTabs({ windowId: 7, practiceTabs: { pins: 9, folders: 10, favorites: 11 } });
    assert.deepEqual(closed, [9]);
    assert.deepEqual(removed, [9]);
});


test('split practice creates and reuses two distinct tabs, and cleanup closes both', async () => {
    const { created, tabs } = mockTabs();
    const step = TOUR_STEPS.findIndex(item => item.id === 'split');
    const first = await preparePractice(state(step), { runId: 'test', step }, TOUR_STEPS);
    const reopened = await preparePractice(first, { runId: 'test', step }, TOUR_STEPS);
    assert.equal(created.length, 2);
    assert.notEqual(first.practiceTabs.split, first.practiceTabs['split-companion']);
    assert.deepEqual(reopened.practiceTabs, first.practiceTabs);
    const removed = [];
    chrome.tabs.remove = async id => removed.push(id);
    await cleanupPracticeTabs(first);
    assert.deepEqual(removed.sort(), tabs.map(tab => tab.id).sort());
});

test('split practice does not create tabs on older Chrome', async () => {
    const { created } = mockTabs();
    delete chrome.tabs.createSplit;
    const step = TOUR_STEPS.findIndex(item => item.id === 'split');
    const original = state(step);
    assert.equal(await preparePractice(original, { runId: 'test', step }, TOUR_STEPS), original);
    assert.equal(created.length, 0);
});

test('a failed split setup removes newly created practice tabs but preserves reused tabs', async () => {
    const { tabs } = mockTabs();
    const step = TOUR_STEPS.findIndex(item => item.id === 'split');
    const removed = [];
    chrome.tabs.remove = async id => removed.push(id);
    let calls = 0;
    chrome.tabs.create = async options => {
        if (++calls === 2) throw new Error('creation failed');
        const tab = { ...options, id: 42 };
        tabs.push(tab);
        return tab;
    };
    await assert.rejects(preparePractice(state(step), { runId: 'test', step }, TOUR_STEPS), /creation failed/);
    assert.deepEqual(removed, [42]);

    tabs.length = 0;
    tabs.push({ id: 50, windowId: 7, url: practiceUrl('test', 'split') });
    removed.length = 0;
    chrome.tabs.create = async () => { throw new Error('creation failed'); };
    await assert.rejects(preparePractice(state(step), { runId: 'test', step }, TOUR_STEPS), /creation failed/);
    assert.deepEqual(removed, []);
});
