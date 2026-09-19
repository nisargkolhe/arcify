import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';

// No internet dependency: all tab navigation uses a local fixture server.
let url;
import { createServer } from 'node:http';
let server;
let browser, page, fixture;
const row = id => `.space.active .tab[data-tab-id="${id}"]`;
async function toggle(id) {
    await page.waitForFunction(id => {
        const el = document.querySelector(`.space.active .tab[data-tab-id="${id}"]`);
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        return true;
    }, { polling: 100 }, id);
    await page.waitForSelector('.context-menu-item');
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('.context-menu-item')]
            .find(el => /^(Pin Tab|Unpin Tab)$/.test(el.textContent));
        if (!item) throw new Error('Pin action missing');
        item.click();
    });
}
async function state() {
    return page.evaluate(async () => {
        const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
        return { spaces, bindings: pinnedTabStatesById };
    });
}

beforeAll(async () => {
    server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Same page</title><p>Duplicate URL fixture</p>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('Sidebar console:', message.text()); });
    fixture = await page.evaluate(async url => {
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        const space = spaces[0];
        const a = await chrome.tabs.create({ url, active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: a.id, spaceId: space.id });
        return { a: a.id, spaceId: space.id, folderId: space.bookmarkFolderId };
    }, url);
    await page.reload();
    await page.waitForSelector(row(fixture.a));
});
afterAll(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test('same-URL tabs remain distinct through pin, navigation, reload, close, reopen and unpin', async () => {
    await toggle(fixture.a);
    await page.waitForFunction(id => document.querySelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${id}"][data-bookmark-id]`), { polling: 100 }, fixture.a);
    const first = (await state()).bindings[fixture.a].bookmarkId;
    const b = await page.evaluate(async ({ url, spaceId }) => {
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
        await chrome.tabs.update(tab.id, { url });
        return tab.id;
    }, { url, spaceId: fixture.spaceId });
    await page.waitForSelector(row(b));
    await page.waitForFunction(id => document.querySelector(`.space.active [data-tab-type="temporary"] .tab[data-tab-id="${id}"]`), { polling: 100 }, b);
    expect((await state()).bindings[b]?.bookmarkId).toBeUndefined();

    await page.waitForFunction(async ({ b, url }) => (await chrome.tabs.get(b)).url === url, { polling: 100 }, { b, url });
    await toggle(b);
    await page.waitForFunction(id => document.querySelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${id}"][data-bookmark-id]`), { polling: 100 }, b);
    const second = (await state()).bindings[b].bookmarkId;
    expect(second).not.toBe(first);
    for (let i = 0; i < 2; i++) {
        await page.reload();
        await page.waitForSelector(row(b));
        expect(await page.$eval(row(fixture.a), el => el.dataset.bookmarkId)).toBe(first);
        expect(await page.$eval(row(b), el => el.dataset.bookmarkId)).toBe(second);
    }

    // Closing B preserves B's bookmark and never redirects its row to A.
    await page.$eval(`${row(b)} .tab-close`, el => el.click());
    await page.waitForSelector(`.space.active .bookmark-only[data-bookmark-id="${second}"]`);
    await page.$eval(`.space.active .bookmark-only[data-bookmark-id="${second}"]`, el => el.click());
    await page.waitForFunction(({ second, a }) => {
        const el = document.querySelector(`.space.active .tab[data-bookmark-id="${second}"][data-tab-id]`);
        return el && Number(el.dataset.tabId) !== a;
    }, { polling: 100 }, { second, a: fixture.a });
    const reopened = await page.$eval(`.space.active .tab[data-bookmark-id="${second}"][data-tab-id]`, el => Number(el.dataset.tabId));
    await toggle(reopened);
    await page.waitForFunction(id => document.querySelector(`.space.active [data-tab-type="temporary"] .tab[data-tab-id="${id}"]`), { polling: 100 }, reopened);
    expect(await page.evaluate(async id => (await chrome.bookmarks.get(id))[0].id, first)).toBe(first);
    expect(await page.evaluate(async id => (await chrome.tabs.get(id)).id, fixture.a)).toBe(fixture.a);
    expect(await page.evaluate(async id => { try { await chrome.bookmarks.get(id); return true; } catch { return false; } }, second)).toBe(false);
}, 60000);

test('native pinning does not hide its same-URL favorite', async () => {
    const binding = (await state()).bindings[fixture.a];
    await page.evaluate(id => chrome.tabs.update(id, { pinned: true }), fixture.a);
    await page.reload();
    await page.waitForSelector(`.space.active .bookmark-only[data-bookmark-id="${binding.bookmarkId}"]`);
    await page.waitForSelector(`#pinnedFavicons [data-tab-id="${fixture.a}"]`);
});

test('closed URL twins render once each and a temporary reorder preserves every bookmark', async () => {
    const ids = await page.evaluate(async ({ folderId, url }) => {
        const a = await chrome.bookmarks.create({ parentId: folderId, url, title: 'Closed twin A' });
        const folder = await chrome.bookmarks.create({ parentId: folderId, title: 'Nested twins' });
        const b = await chrome.bookmarks.create({ parentId: folder.id, url, title: 'Closed twin B' });
        return [a.id, b.id];
    }, { folderId: fixture.folderId, url });
    await page.reload();
    for (const id of ids) {
        await page.waitForSelector(`.space.active .bookmark-only[data-bookmark-id="${id}"]`);
        expect(await page.$$eval(`.space.active .tab[data-bookmark-id="${id}"]`, els => els.length)).toBe(1);
    }
    const temp = await page.evaluate(async ({ url, spaceId }) => {
        const tab = await chrome.tabs.create({ url, active: false });
        await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
        return tab.id;
    }, { url, spaceId: fixture.spaceId });
    await page.waitForFunction(id => {
        const el = document.querySelector(`.space.active .tab[data-tab-id="${id}"]`);
        if (!el) return false;
        el.classList.add('dragging');
        const container = el.closest('[data-tab-type="temporary"]');
        container.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }));
        el.classList.remove('dragging');
        return true;
    }, { polling: 100 }, temp);
    await page.waitForFunction(async id => {
        const { spaces } = await chrome.storage.local.get('spaces');
        return spaces.some(s => s.temporaryTabs.includes(id));
    }, { polling: 100 }, temp);
    await page.reload();
    for (const id of ids) {
        await page.waitForSelector(`.space.active .bookmark-only[data-bookmark-id="${id}"]`);
    }
    await page.waitForSelector(row(temp));
});

test('external bookmark creation, rename and deletion update the open sidebar', async () => {
    const id = await page.evaluate(async ({ folderId, url }) =>
        (await chrome.bookmarks.create({ parentId: folderId, url: `${url}external`, title: 'External original' })).id,
    { folderId: fixture.folderId, url });
    await page.waitForSelector(`.space.active .bookmark-only[data-bookmark-id="${id}"]`);
    await page.evaluate(id => chrome.bookmarks.update(id, { title: 'External renamed' }), id);
    await page.waitForFunction(id => document.querySelector(`.space.active .tab[data-bookmark-id="${id}"] .tab-title-display`)?.textContent === 'External renamed',
        { polling: 100 }, id);
    await page.evaluate(id => chrome.bookmarks.remove(id), id);
    await page.waitForFunction(id => !document.querySelector(`.space.active .tab[data-bookmark-id="${id}"]`), { polling: 100 }, id);
});

test('service-worker ordering matches real Chrome move semantics and rejects partial views', async () => {
    const ordered = await page.evaluate(async folderId => {
        const folder = await chrome.bookmarks.create({ parentId: folderId, title: 'Order fixture' });
        const nodes = [];
        for (const title of ['A', 'B', 'C']) nodes.push(await chrome.bookmarks.create({ parentId: folder.id, title, url: `https://${title.toLowerCase()}.test/` }));
        const first = await chrome.runtime.sendMessage({ type: 'bookmarkOrder', parentId: folder.id,
            displayIds: [nodes[2].id, nodes[0].id, nodes[1].id], inverted: false });
        const second = await chrome.runtime.sendMessage({ type: 'bookmarkOrder', parentId: folder.id,
            displayIds: [nodes[0].id, nodes[2].id, nodes[1].id], inverted: true });
        const partial = await chrome.runtime.sendMessage({ type: 'bookmarkOrder', parentId: folder.id,
            displayIds: [nodes[0].id, nodes[1].id], inverted: false });
        return { first, second, partial, live: (await chrome.bookmarks.getChildren(folder.id)).map(node => node.id), ids: nodes.map(node => node.id) };
    }, fixture.folderId);
    expect(ordered.first.success).toBe(true);
    expect(ordered.second.success).toBe(true);
    expect(ordered.live).toEqual([ordered.ids[1], ordered.ids[2], ordered.ids[0]]);
    expect(ordered.partial.success).toBe(false);
});

test('reordering native pinned favicons updates Chrome and survives reload', async () => {
    const another = await page.evaluate(async url => (await chrome.tabs.create({ url, pinned: true, active: false })).id, url);
    await page.waitForSelector(`#pinnedFavicons [data-tab-id="${another}"]`);
    await page.$eval(`#pinnedFavicons [data-tab-id="${fixture.a}"]`, el => {
        el.classList.add('dragging');
        el.parentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 100000 }));
        el.classList.remove('dragging');
    });
    await page.waitForFunction(async id => {
        const tabs = await chrome.tabs.query({ pinned: true, currentWindow: true });
        return tabs.sort((a, b) => a.index - b.index).at(-1)?.id === id;
    }, { polling: 100 }, fixture.a);
    await page.reload();
    await page.waitForSelector(`#pinnedFavicons [data-tab-id="${another}"]`);
    expect(await page.$$eval('#pinnedFavicons .pinned-favicon', els => Number(els.at(-1).dataset.tabId))).toBe(fixture.a);
});

test('new folders have a bookmark identity before naming and remain usable after Escape', async () => {
    const before = await page.$$eval('.space.active .folder', els => els.map(el => el.dataset.bookmarkId));
    await page.$eval('.space.active .new-folder-btn', el => el.click());
    await page.waitForFunction(before => [...document.querySelectorAll('.space.active .folder')]
        .some(el => el.dataset.bookmarkId && !before.includes(el.dataset.bookmarkId)), { polling: 100 }, before);
    const id = await page.$$eval('.space.active .folder', (els, before) => els.find(el => !before.includes(el.dataset.bookmarkId)).dataset.bookmarkId, before);
    expect(await page.evaluate(async id => (await chrome.bookmarks.get(id))[0].title, id)).toBe('Untitled');
    await page.$eval(`.space.active .folder[data-bookmark-id="${id}"] > .folder-header .folder-name`, el => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await page.reload();
    await page.waitForSelector(`.space.active .folder[data-bookmark-id="${id}"]`);
});

test('deleting one of two same-named spaces removes only its exact bookmark folder', async () => {
    const twin = await page.evaluate(async folderId => {
        const [home] = await chrome.bookmarks.get(folderId);
        const first = await chrome.bookmarks.create({ parentId: home.parentId, title: 'Duplicate space' });
        const second = await chrome.bookmarks.create({ parentId: home.parentId, title: 'Duplicate space' });
        const kept = await chrome.bookmarks.create({ parentId: first.id, url: 'https://keep.test/', title: 'Keep this' });
        const removed = await chrome.bookmarks.create({ parentId: second.id, url: 'https://remove.test/', title: 'Remove this' });
        const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
        return { first: first.id, second: second.id, kept: kept.id, removed: removed.id,
            spaceId: spaces.find(s => s.bookmarkFolderId === second.id).id };
    }, fixture.folderId);
    await page.reload();
    await page.waitForSelector(`.space[data-space-id="${twin.spaceId}"] .delete-space-btn`);
    page.once('dialog', dialog => dialog.accept());
    await page.$eval(`.space[data-space-id="${twin.spaceId}"] .delete-space-btn`, el => el.click());
    await page.waitForFunction(async id => {
        try { await chrome.bookmarks.get(id); return false; } catch { return true; }
    }, { polling: 100 }, twin.second);
    expect(await page.evaluate(async id => (await chrome.bookmarks.get(id))[0].parentId, twin.kept)).toBe(twin.first);
    await page.waitForFunction(async id => !(await chrome.storage.local.get('spaces')).spaces.some(s => s.id === id), { polling: 100 }, twin.spaceId);
});
