import { launchBrowserWithExtension, openSidebar } from './helpers/extension-helper.js';
import { createServer } from 'node:http';

// Needs Chrome 155+ (pinned in .puppeteerrc.cjs). No internet: tabs load a local fixture server.
let server, baseUrl, browser, page, spaceId;
const row = id => `.space.active .tab[data-tab-id="${id}"]`;

async function openTabs(...paths) {
    const ids = await page.evaluate(async ({ urls, spaceId }) => {
        const created = [];
        for (const url of urls) {
            const tab = await chrome.tabs.create({ url, active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            created.push(tab.id);
        }
        return created;
    }, { urls: paths.map(path => `${baseUrl}${path}`), spaceId });
    for (const id of ids) await page.waitForSelector(row(id));
    return ids;
}

async function menu(id, label) {
    await page.waitForFunction(id => {
        const el = document.querySelector(`.space.active .tab[data-tab-id="${id}"]`);
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        return true;
    }, { polling: 100 }, id);
    await page.waitForSelector('#tab-context-menu .context-menu-item');
    await page.evaluate(label => {
        const item = [...document.querySelectorAll('#tab-context-menu .context-menu-item')].find(el => el.textContent === label);
        if (!item) throw new Error(`Menu item "${label}" missing`);
        item.click();
    }, label);
}

// ⌘/Ctrl-clicks to select exactly these rows.
async function selectOnly(ids) {
    const toggle = id => page.$eval(row(id), el => el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, button: 0, metaKey: true, ctrlKey: true })));
    for (const id of ids) await toggle(id);
    // The selection starts from the active tab; drop it.
    const extra = await page.evaluate(ids => [...document.querySelectorAll('.space.active .tab.multi-selected')]
        .map(el => Number(el.dataset.tabId)).filter(id => !ids.includes(id)), ids);
    for (const id of extra) await toggle(id);
    await page.waitForFunction(count => document.querySelectorAll('.space.active .tab.multi-selected').length === count, { polling: 100 }, ids.length);
}

// The titles of the folders above path's bookmark, nearest first, and how many bookmarks its own folder holds.
const bookmarkFolders = path => page.evaluate(async path => {
    const [bookmark] = (await chrome.bookmarks.search({ query: path })).filter(node => node.url);
    const titles = [];
    for (let id = bookmark.parentId; id; ) {
        const [node] = await chrome.bookmarks.get(id);
        titles.push(node.title);
        id = node.parentId;
    }
    return { titles, siblings: (await chrome.bookmarks.getChildren(bookmark.parentId)).length };
}, path);

const splitIds = ids => page.evaluate(async ids => Promise.all(ids.map(async id => (await chrome.tabs.get(id)).splitViewId)), ids);
const isPaired = ([a, b]) => a === b && a !== -1;

beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<title>Page ${req.url}</title><p>${req.url}</p>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const result = await launchBrowserWithExtension();
    browser = result.browser;
    page = await openSidebar(browser, result.extensionId);
    page.on('pageerror', error => console.error('Sidebar error:', error.message));
    page.on('dialog', dialog => { console.error('Sidebar alert:', dialog.message()); dialog.dismiss(); });
    spaceId = await page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' })).spaces[0].id);
});
afterAll(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test('a live split shows as one row and Unsplit separates it', async () => {
    const [left, right] = await openTabs('/left', '/right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    await page.waitForSelector(`${row(right)}.split-right`);

    await menu(right, 'Unsplit');
    await page.waitForFunction(id => !document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('split-right'), { polling: 100 }, right);
    expect(isPaired(await splitIds([left, right]))).toBe(false);
});

test('pinning either half pins the split as a marked folder that reopens as a split', async () => {
    const [left, right] = await openTabs('/pin-left', '/pin-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);

    await menu(right, 'Pin Tab');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .split-folder ${row(left).replace('.space.active ', '')}`);
    const folder = await page.evaluate(async ({ left, right }) => {
        const { pinnedTabStatesById: bindings } = await chrome.storage.local.get('pinnedTabStatesById');
        const [bookmark] = await chrome.bookmarks.get(bindings[left].bookmarkId);
        const [parent] = await chrome.bookmarks.getSubTree(bookmark.parentId);
        return { title: parent.title, children: parent.children.map(child => child.id),
            bound: [bindings[left].bookmarkId, bindings[right].bookmarkId] };
    }, { left, right });
    expect(folder.title.startsWith('⧉ ')).toBe(true);
    expect(folder.children).toEqual(folder.bound);

    // Closing either half closes both; clicking a closed half reopens the pair as a split.
    await page.$eval(`${row(left)} .tab-close`, el => el.click());
    await page.waitForFunction(() => document.querySelectorAll('.space.active .split-folder .tab.bookmark-only').length === 2, { polling: 100 });
    await page.$eval('.space.active .split-folder .tab.bookmark-only', el => el.click());
    const reopened = await page.waitForFunction(async () => {
        const { pinnedTabStatesById: bindings = {} } = await chrome.storage.local.get('pinnedTabStatesById');
        const live = (await chrome.tabs.query({})).filter(tab => bindings[tab.id] && tab.url.includes('/pin-'));
        return live.length === 2 && live[0].splitViewId !== -1 && live[0].splitViewId === live[1].splitViewId ? live.map(tab => tab.id) : false;
    }, { polling: 200, timeout: 10000 });
    expect((await reopened.jsonValue()).length).toBe(2);
});

test('selecting two tabs and choosing Split View joins them, upper row on the left', async () => {
    const ids = await openTabs('/join-a', '/join-b');
    const select = id => page.$eval(row(id), el => el.dispatchEvent(
        // metaKey selects on macOS and ctrlKey elsewhere; setting both works on either.
        new MouseEvent('click', { bubbles: true, button: 0, metaKey: true, ctrlKey: true })));
    for (const id of ids) await select(id);
    // A new selection also takes in the active tab when it is in the sidebar; drop anything else.
    const extra = await page.evaluate(ids => [...document.querySelectorAll('.space.active .tab.multi-selected')]
        .map(el => Number(el.dataset.tabId)).filter(id => !ids.includes(id)), ids);
    for (const id of extra) await select(id);
    await page.waitForFunction(() => document.querySelectorAll('.space.active .tab.multi-selected').length === 2, { polling: 100 });

    // Arcify may list newer temporary tabs first, so read the sidebar order rather than assume it.
    const [upper, lower] = await page.evaluate(ids => [...document.querySelectorAll('.space.active .tab[data-tab-id]')]
        .map(el => Number(el.dataset.tabId)).filter(id => ids.includes(id)), ids);
    await menu(upper, 'Split View');
    await page.waitForFunction(async ([upper, lower]) => {
        const [left, right] = await Promise.all([chrome.tabs.get(upper), chrome.tabs.get(lower)]);
        return left.splitViewId !== -1 && left.splitViewId === right.splitViewId && left.index < right.index;
    }, { polling: 100 }, [upper, lower]);
    await page.waitForSelector(`${row(upper)}.split-left`);
});

test('opening a link beside a favorite leaves the favorite alone and splits a copy with the link', async () => {
    const [favorite] = await openTabs('/favorite');
    await menu(favorite, 'Pin Tab');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${favorite}"][data-bookmark-id]`);
    // What opening a link beside a pinned tab does.
    const link = await page.evaluate(async ({ url, favorite }) => (await chrome.tabs.create({ url, splitWithTabId: favorite })).id,
        { url: `${baseUrl}/beside-favorite`, favorite });

    const result = await page.waitForFunction(async ({ favorite, link }) => {
        const tabs = await chrome.tabs.query({});
        const fav = tabs.find(tab => tab.id === favorite);
        const linked = tabs.find(tab => tab.id === link);
        const copy = tabs.find(tab => tab.id !== link && tab.splitViewId !== -1 && tab.splitViewId === linked?.splitViewId);
        if (!fav || fav.splitViewId !== -1 || !copy) return false;
        const { pinnedTabStatesById: bindings = {}, spaces } = await chrome.storage.local.get(['pinnedTabStatesById', 'spaces']);
        return {
            favoriteBound: Boolean(bindings[favorite]), copyUrl: copy.url, copyBound: Boolean(bindings[copy.id]),
            copyLeftOfLink: copy.index < linked.index, linkActive: linked.active,
            unpinned: spaces.some(space => space.temporaryTabs.includes(copy.id) && space.temporaryTabs.includes(link))
        };
    }, { polling: 200, timeout: 10000 }, { favorite, link });
    expect(await result.jsonValue()).toEqual({
        favoriteBound: true, copyUrl: `${baseUrl}/favorite`, copyBound: false,
        copyLeftOfLink: true, linkActive: true, unpinned: true
    });
    await page.waitForSelector(`${row(link)}.split-right`);
});

test('Pin and Unpin N Tabs act on a selected split whole, once', async () => {
    const [plain, left, right] = await openTabs('/multi-plain', '/multi-left', '/multi-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    const selectAll = () => selectOnly([plain, left, right]);

    await selectAll();
    await menu(plain, 'Pin 3 Tabs');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .split-folder .tab[data-tab-id="${left}"]`);
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${plain}"][data-bookmark-id]`);
    const folders = await page.evaluate(async () => {
        const halves = (await chrome.bookmarks.search({ query: '/multi-left' })).filter(node => node.url);
        return Promise.all([...new Set(halves.map(half => half.parentId))].map(async id => (await chrome.bookmarks.get(id))[0].title));
    });
    expect(folders).toHaveLength(1);
    expect(folders[0].startsWith('⧉ ')).toBe(true);
    expect(isPaired(await splitIds([left, right]))).toBe(true);

    await selectAll();
    await menu(plain, 'Unpin 3 Tabs');
    await page.waitForFunction(id => !document.querySelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${id}"]`), { polling: 100 }, left);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ query: '/multi-' })).length)).toBe(0);
    expect(isPaired(await splitIds([left, right]))).toBe(true);
});

test('choosing Split View for a favorite and an unpinned tab pins them as a pair', async () => {
    const [favorite, other] = await openTabs('/join-favorite', '/join-other');
    await menu(favorite, 'Pin Tab');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${favorite}"][data-bookmark-id]`);
    const select = id => page.$eval(row(id), el => el.dispatchEvent(
        new MouseEvent('click', { bubbles: true, button: 0, metaKey: true, ctrlKey: true })));
    for (const id of [favorite, other]) await select(id);
    const extra = await page.evaluate(ids => [...document.querySelectorAll('.space.active .tab.multi-selected')]
        .map(el => Number(el.dataset.tabId)).filter(id => !ids.includes(id)), [favorite, other]);
    for (const id of extra) await select(id);
    await page.waitForFunction(() => document.querySelectorAll('.space.active .tab.multi-selected').length === 2, { polling: 100 });

    await menu(other, 'Split View');
    await page.waitForSelector(`.space.active .split-folder .tab[data-tab-id="${favorite}"]`);
    await page.waitForSelector(`.space.active .split-folder .tab[data-tab-id="${other}"]`);
    const [a, b] = await splitIds([favorite, other]);
    expect(isPaired([a, b])).toBe(true);
});

test('dragging both selected halves into Pinned pins the split once', async () => {
    const [left, right] = await openTabs('/drag-left', '/drag-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    await selectOnly([left, right]);
    await page.$eval(row(left), el => el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })));
    await page.waitForFunction(() => document.querySelectorAll('.tab.multi-dragging').length === 2, { polling: 100 });
    await page.$eval('.space.active [data-tab-type="pinned"]', target => {
        const dataTransfer = new DataTransfer();
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .split-folder .tab[data-tab-id="${right}"]`);
    await page.$eval(row(left), el => el.dispatchEvent(new DragEvent('dragend', { bubbles: true })));

    const { titles, siblings } = await bookmarkFolders('/drag-left');
    expect(titles[0].startsWith('⧉ ')).toBe(true);
    expect(titles[1].startsWith('⧉ ')).toBe(false);
    expect(siblings).toBe(2);
    expect(isPaired(await splitIds([left, right]))).toBe(true);
});

test('New Folder with one half of a pinned split moves the whole split in', async () => {
    const [plain, left, right] = await openTabs('/folder-plain', '/folder-left', '/folder-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    await menu(left, 'Pin Tab');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .split-folder .tab[data-tab-id="${left}"]`);
    await selectOnly([plain, left]);
    await menu(plain, 'New Folder with 2 Items');
    // New Folder opens its name for editing, which holds back sidebar refreshes until it's done.
    await page.waitForFunction(() => document.activeElement?.classList.contains('folder-name'), { polling: 100 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(async () => {
        const [plain] = (await chrome.bookmarks.search({ query: '/folder-plain' })).filter(node => node.url);
        const [bookmark] = (await chrome.bookmarks.search({ query: '/folder-left' })).filter(node => node.url);
        if (!plain || !bookmark) return false;
        const [split] = await chrome.bookmarks.get(bookmark.parentId);
        return split.parentId === plain.parentId;
    }, { polling: 100 });

    for (const path of ['/folder-left', '/folder-right']) {
        const { titles, siblings } = await bookmarkFolders(path);
        expect(titles[0].startsWith('⧉ ')).toBe(true);
        expect(titles[1]).toBe('New Folder');
        expect(siblings).toBe(2);
    }
    expect(isPaired(await splitIds([left, right]))).toBe(true);
});

test('a split renamed as a whole shows one row, keeps its name when pinned, and clears back to two halves', async () => {
    const [left, right] = await openTabs('/name-left', '/name-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    const rename = async (name) => {
        await page.waitForSelector('.split-name-input');
        await page.$eval('.split-name-input', el => { el.value = ''; });
        await page.focus('.split-name-input');
        if (name) await page.keyboard.type(name);
        await page.keyboard.press('Enter');
    };
    const shownName = id => page.$eval(`${row(id)}.split-named .tab-split-name`, el => el.textContent);

    await menu(right, 'Rename Split View');
    await rename('Inbox + Cal');
    await page.waitForSelector(`${row(left)}.split-named`);
    expect(await shownName(left)).toBe('Inbox + Cal');

    await menu(left, 'Pin Tab');
    await page.waitForSelector(`.space.active [data-tab-type="pinned"] .split-folder ${row(left).replace('.space.active ', '')}.split-named`);
    const folderTitle = () => page.evaluate(async id => {
        const { pinnedTabStatesById: bindings } = await chrome.storage.local.get('pinnedTabStatesById');
        const [bookmark] = await chrome.bookmarks.get(bindings[id].bookmarkId);
        return (await chrome.bookmarks.get(bookmark.parentId))[0].title;
    }, left);
    expect(await folderTitle()).toBe('⧉ Inbox + Cal');

    await page.$eval(`${row(left)}.split-named`, el => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await rename('');
    await page.waitForFunction(id => !document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('split-named'), { polling: 100 }, left);
    expect(await folderTitle()).toBe('⧉ Page /name-left | Page /name-right');
});

test('the Rename shortcut edits the active tab, or its whole split', async () => {
    const [single, left, right] = await openTabs('/rename-single', '/rename-left', '/rename-right');
    await page.evaluate(ids => chrome.tabs.createSplit(ids), [left, right]);
    await page.waitForSelector(`${row(left)}.split-left`);
    const worker = await (await browser.waitForTarget(target => target.type() === 'service_worker')).worker();
    const shortcut = async tabId => {
        await page.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
        await worker.evaluate(() => chrome.runtime.sendMessage({ command: 'renameTab' }));
    };
    const escape = selector => page.$eval(selector, el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    await shortcut(single);
    await page.waitForFunction(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"] .tab-title-input`)?.style.display === 'inline-block', { polling: 100 }, single);
    await escape(`${row(single)} .tab-title-input`);

    await shortcut(right);
    await page.waitForSelector(`${row(left)}.split-renaming .split-name-input`);
    await escape('.split-name-input');
    await page.waitForFunction(() => !document.querySelector('.split-name-input'), { polling: 100 });
});
