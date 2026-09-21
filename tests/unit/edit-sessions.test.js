import test from 'node:test';
import assert from 'node:assert/strict';
import { EditSessionRegistry } from '../../edit-sessions.js';

test('an editor remains active through async commit and wakes refresh once on release', async () => {
    let release;
    let wakes = 0;
    let commits = 0;
    const registry = new EditSessionRegistry(() => wakes++);
    const session = registry.begin('folder', '123');
    const first = registry.complete(session, async () => {
        commits++;
        await new Promise(resolve => { release = resolve; });
    });
    const second = registry.complete(session, async () => { commits++; });
    assert.equal(first, second);
    assert.equal(registry.isActive(), true);
    await Promise.resolve();
    release();
    await first;
    assert.equal(commits, 1);
    assert.equal(registry.isActive(), false);
    assert.equal(wakes, 1);
});

test('cancel releases the exact editor even when its operation fails', async () => {
    const registry = new EditSessionRegistry();
    const session = registry.begin('tab', 7);
    await assert.rejects(registry.complete(session, async () => { throw new Error('deleted'); }), /deleted/);
    assert.equal(registry.isActive(), false);
});

test('disposing a row owner releases an unblurred editor and wakes pending refresh', async () => {
    let wakes = 0;
    const registry = new EditSessionRegistry(() => wakes++);
    registry.begin('tab', 42);
    registry.begin('folder', 'kept');
    registry.dispose('tab', 42);
    assert.equal(registry.isActive(), true);
    assert.equal(wakes, 0);
    registry.dispose('folder', 'kept');
    assert.equal(registry.isActive(), false);
    assert.equal(wakes, 1);
});

test('a new editor can be readdressed to its durable bookmark ID before disposal', () => {
    const registry = new EditSessionRegistry();
    const session = registry.begin('folder', 'new:space');
    registry.setOwner(session, 'folder', 'bookmark-7');
    registry.dispose('folder', 'new:space');
    assert.equal(registry.isActive(), true);
    registry.dispose('folder', 'bookmark-7');
    assert.equal(registry.isActive(), false);
});
