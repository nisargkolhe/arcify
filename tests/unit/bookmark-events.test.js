import test from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { return Promise.all(this.listeners.map(fn => fn(...args))); } });

test('bookmark listeners ignore unrelated edits and coalesce Arcify subtree changes', async () => {
    const events = { onCreated: event(), onRemoved: event(), onMoved: event(), onChanged: event(), onChildrenReordered: event(), onImportBegan: event(), onImportEnded: event() };
    const nodes = {
        root: { id: 'root', title: 'Arcify' }, space: { id: 'space', parentId: 'root' }, favorite: { id: 'favorite', parentId: 'space', url: 'https://one.test/' },
        other: { id: 'other', parentId: 'outside' }
    };
    const messages = [];
    globalThis.chrome = {
        bookmarks: { ...events, search: async () => [nodes.root], get: async id => nodes[id] ? [nodes[id]] : [] },
        runtime: { sendMessage: async message => messages.push(message) }
    };
    const { registerBookmarkListeners } = await import(`../../bookmark-events.js?test=${Date.now()}`);
    registerBookmarkListeners();
    await events.onChanged.emit('other');
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.deepEqual(messages, []);
    await events.onChanged.emit('favorite');
    await events.onMoved.emit('favorite', { parentId: 'space', oldParentId: 'space' });
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].action, 'arcifyBookmarksChanged');
    await events.onRemoved.emit('root', { parentId: 'outside' });
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.equal(messages.at(-1).reason, 'root-removed');
});
