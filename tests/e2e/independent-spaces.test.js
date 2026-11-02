import { launchBrowserWithExtension, openSidebar, createSpace } from './helpers/extension-helper.js';

describe('Independent spaces', () => {
    let browser, extensionId, page;
    beforeAll(async () => { ({ browser, extensionId } = await launchBrowserWithExtension()); });
    afterAll(async () => { await browser?.close(); });
    test('space membership survives native group edits, sidebar closure, and optional sync toggling', async () => {
        page = await openSidebar(browser, extensionId);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        expect(await page.evaluate(() => chrome.tabGroups.query({}))).toEqual([]);
        await page.close();
        page = await createSpace(browser, extensionId, 'Independent Work', 'blue');
        page.on('pageerror', error => errors.push(error.message));
        const setup = await page.evaluate(async () => {
            const request = async (action, extra = {}) => (await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...extra })).spaces;
            const spaces = await request('get');
            const work = spaces.find(s => s.name === 'Independent Work');
            const tab = await chrome.tabs.create({ url: 'https://example.com/', active: false });
            await request('assign', { tabId: tab.id, spaceId: work.id });
            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
            await chrome.tabGroups.update(groupId, { title: 'Native only', color: 'red' });
            return { tabId: tab.id, spaceId: work.id, groupId };
        });
        await page.evaluate(async ({ tabId, groupId }) => {
            await chrome.tabs.ungroup(tabId);
            const recreated = await chrome.tabs.group({ tabIds: [tabId] });
            await chrome.tabGroups.update(recreated, { title: 'Still native', color: 'green' });
            await chrome.tabs.move(tabId, { index: -1 });
        }, setup);
        await page.waitForFunction(async ({ spaceId, tabId }) => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return response.spaces.find(s => s.id === spaceId)?.temporaryTabs.includes(tabId);
        }, { polling: 100 }, setup);
        await page.close();
        const helper = await browser.newPage();
        await helper.goto(`chrome-extension://${extensionId}/options.html`);
        const child = await helper.evaluate(async ({ tabId }) => {
            const tab = await chrome.tabs.create({ openerTabId: tabId, url: 'https://example.org/', active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return tab.id;
        }, setup);
        await helper.waitForFunction(async ({ spaceId, child }) => {
            const { spaces } = await chrome.storage.local.get('spaces');
            return spaces.find(s => s.id === spaceId)?.temporaryTabs.includes(child);
        }, { polling: 100 }, { ...setup, child });
        await helper.evaluate(async child => { await chrome.tabs.move(child, { index: 0 }); }, child);
        expect(await helper.evaluate(async spaceId => {
            const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return response.spaces.find(s => s.id === spaceId).temporaryTabs;
        }, setup.spaceId)).toEqual([setup.tabId, child]);
        expect(await helper.$eval('#syncTabGroups', el => el.checked)).toBe(false);
        await helper.$eval('#syncTabGroups', input => input.click());
        await helper.waitForFunction(async ({ tabId, child }) => {
            const a = await chrome.tabs.get(tabId), b = await chrome.tabs.get(child);
            if (a.groupId === -1 || a.groupId !== b.groupId) return false;
            const members = await chrome.tabs.query({ groupId: a.groupId });
            return (await chrome.tabGroups.get(a.groupId)).title === 'Independent Work'
                && members.map(t => t.id).join(',') === [tabId, child].join(',');
        }, { polling: 100 }, { ...setup, child });
        await helper.$eval('#syncTabGroups', input => input.click());
        await helper.waitForFunction(async () => !(await chrome.storage.sync.get('syncTabGroups')).syncTabGroups, { polling: 100 });
        await helper.evaluate(() => chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' }));
        await helper.evaluate(async ({ tabId }) => {
            const tab = await chrome.tabs.get(tabId);
            await chrome.tabGroups.update(tab.groupId, { title: 'Leave me alone' });
        }, setup);
        await new Promise(r => setTimeout(r, 500));
        expect(await helper.evaluate(async ({ tabId }) => {
            const tab = await chrome.tabs.get(tabId);
            return (await chrome.tabGroups.get(tab.groupId)).title;
        }, setup)).toBe('Leave me alone');
        await helper.evaluate(async ({ tabId, child }) => { await chrome.tabs.remove([tabId, child]); }, { ...setup, child });
        await helper.waitForFunction(async spaceId => {
            const { spaces } = await chrome.storage.local.get('spaces');
            const space = spaces.find(s => s.id === spaceId);
            return space && space.temporaryTabs.length === 0;
        }, { polling: 100 }, setup.spaceId);
        page = await openSidebar(browser, extensionId);
        expect(await page.$(`[data-space-id="${setup.spaceId}"]`)).not.toBeNull();
        const homeId = await page.evaluate(async () => (await chrome.storage.local.get('spaces')).spaces.find(s => s.name === 'Home').id);
        await page.$eval(`#spaceSwitcher button[data-space-id="${homeId}"]`, button => button.click());
        const laterId = await helper.evaluate(async spaceId => {
            const tab = await chrome.tabs.create({ url: 'https://example.net/', active: false });
            await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
            return tab.id;
        }, setup.spaceId);
        await page.$eval(`#spaceSwitcher button[data-space-id="${setup.spaceId}"]`, button => button.click());
        await page.waitForSelector(`.space.active .tab[data-tab-id="${laterId}"]`);
        expect(await page.$$eval(`.tab[data-tab-id="${laterId}"]`, tabs => tabs.length)).toBe(1);
        expect(errors).toEqual([]);
    });

    test('folder context menu creates a nested folder under the selected parent', async () => {
        page = await openSidebar(browser, extensionId);
        const folderName = `Parent ${Date.now()}`;
        const childName = `Child ${Date.now()}`;
        const grandchildName = `Grandchild ${Date.now()}`;
        const parent = await page.evaluate(async title => {
            await chrome.storage.sync.set({ syncTabGroups: false });
            const spaceName = document.querySelector('.space.active .space-name').value;
            const arcify = (await chrome.bookmarks.search({ title: 'Arcify' })).find(node => !node.url);
            const spaceFolder = (await chrome.bookmarks.getChildren(arcify.id))
                .find(node => !node.url && node.title === spaceName);
            const parent = await chrome.bookmarks.create({ parentId: spaceFolder.id, title });
            const nestedTab = await chrome.bookmarks.create({
                parentId: parent.id,
                title: 'Nested tab',
                url: 'https://example.com/?nested-context-menu'
            });
            return { ...parent, nestedTabId: nestedTab.id };
        }, folderName);

        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            const parentSelector = `.folder[data-bookmark-id="${parent.id}"]`;
            await page.waitForFunction(selector => {
                const header = document.querySelector(selector);
                if (!header) return false;
                header.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: 12,
                    clientY: 12,
                    button: 2
                }));
                return true;
            }, { polling: 100 }, `${parentSelector} > .folder-header`);
            await page.waitForSelector('.folder-context-menu');

            expect(await page.$eval('.folder-context-menu .context-menu-item', item => ({
                text: item.textContent.trim(),
                disabled: item.disabled
            }))).toEqual({ text: 'New Folder', disabled: false });

            await page.evaluate(() => document.querySelector('.folder-context-menu')?.remove());
            const nestedTabTitle = `${parentSelector} > .folder-content > .tab[data-bookmark-id="${parent.nestedTabId}"] .tab-title-display`;
            await page.waitForFunction(selector => {
                const header = document.querySelector(selector);
                if (!header) return false;
                header.click();
                return true;
            }, { polling: 100 }, `${parentSelector} > .folder-header`);
            await page.waitForSelector(nestedTabTitle, { visible: true });
            await page.waitForFunction(selector => {
                const title = document.querySelector(selector);
                if (!title) return false;
                title.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
                return true;
            }, { polling: 100 }, nestedTabTitle);
            await page.waitForSelector('#tab-context-menu');
            expect(await page.$('.folder-context-menu')).toBeNull();
            await page.evaluate(() => document.getElementById('tab-context-menu')?.remove());

            await page.waitForFunction(selector => {
                const header = document.querySelector(selector);
                if (!header) return false;
                header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
                return true;
            }, { polling: 100 }, `${parentSelector} > .folder-header`);
            await page.waitForSelector('.folder-context-menu');
            await page.$eval('.folder-context-menu .context-menu-item', item => item.click());
            const newFolderInput = `${parentSelector} > .folder-content > .folder .folder-name`;
            await page.waitForSelector(newFolderInput, { visible: true });
            await page.type(newFolderInput, childName);
            await page.keyboard.press('Enter');

            await page.waitForFunction(async ({ parentId, title }) => {
                return (await chrome.bookmarks.getChildren(parentId))
                    .some(node => !node.url && node.title === title);
            }, { polling: 100 }, { parentId: parent.id, title: childName });

            const child = await page.evaluate(async ({ parentId, title }) => {
                return (await chrome.bookmarks.getChildren(parentId))
                    .find(node => !node.url && node.title === title);
            }, { parentId: parent.id, title: childName });
            const childSelector = `${parentSelector} > .folder-content > .folder[data-bookmark-id="${child.id}"]`;
            await page.waitForSelector(childSelector);

            await page.waitForFunction(selector => {
                const header = document.querySelector(selector);
                if (!header) return false;
                header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
                return true;
            }, { polling: 100 }, `${childSelector} > .folder-header`);
            await page.waitForSelector('.folder-context-menu');
            expect(await page.$eval('.folder-context-menu .context-menu-item', item => item.disabled)).toBe(false);

            await page.$eval('.folder-context-menu .context-menu-item', item => item.click());
            const grandchildInput = `${childSelector} > .folder-content > .folder .folder-name`;
            await page.waitForSelector(grandchildInput, { visible: true });
            await page.type(grandchildInput, grandchildName);
            await page.keyboard.press('Enter');

            await page.waitForFunction(async ({ parentId, title }) => {
                return (await chrome.bookmarks.getChildren(parentId))
                    .some(node => !node.url && node.title === title);
            }, { polling: 100 }, { parentId: child.id, title: grandchildName });

            const grandchild = await page.evaluate(async ({ parentId, title }) => {
                return (await chrome.bookmarks.getChildren(parentId))
                    .find(node => !node.url && node.title === title);
            }, { parentId: child.id, title: grandchildName });
            const grandchildSelector = `${childSelector} > .folder-content > .folder[data-bookmark-id="${grandchild.id}"]`;
            await page.waitForSelector(`${grandchildSelector} > .folder-header`);
            await page.waitForFunction(selector => {
                const header = document.querySelector(selector);
                if (!header) return false;
                header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
                return true;
            }, { polling: 100 }, `${grandchildSelector} > .folder-header`);
            await page.waitForSelector('.folder-context-menu');
            expect(await page.$eval('.folder-context-menu .context-menu-item', item => item.textContent.trim())).toBe('New Folder');
        } finally {
            await page.evaluate(async id => {
                await chrome.storage.sync.set({ syncTabGroups: false });
                await chrome.bookmarks.removeTree(id);
            }, parent.id);
            await page.close();
        }
    });

    test('shift-selected tabs share context actions and drag into a folder together', async () => {
        const spaceName = `Multi Select ${Date.now()}`;
        page = await createSpace(browser, extensionId, spaceName, 'purple');
        const setup = await page.evaluate(async name => {
            const { spaces } = await chrome.storage.local.get('spaces');
            const space = spaces.find(item => item.name === name);
            const arcify = (await chrome.bookmarks.search({ title: 'Arcify' })).find(node => !node.url);
            const spaceFolder = (await chrome.bookmarks.getChildren(arcify.id))
                .find(node => !node.url && node.title === name);
            const folder = await chrome.bookmarks.create({ parentId: spaceFolder.id, title: 'Drop Target' });
            const tabIds = [];
            for (let index = 0; index < 3; index++) {
                const tab = await chrome.tabs.create({
                    url: `https://example.com/?multi=${index}-${Date.now()}`,
                    active: false
                });
                await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId: space.id });
                tabIds.push(tab.id);
            }
            return { spaceId: space.id, spaceFolderId: spaceFolder.id, folderId: folder.id, tabIds };
        }, spaceName);

        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            for (const tabId of setup.tabIds) {
                await page.waitForSelector(`.space.active .tab[data-tab-id="${tabId}"]`);
            }
            await page.evaluate(first => {
                document.querySelector(`.tab[data-tab-id="${first}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
            }, setup.tabIds[0]);
            await page.waitForFunction(tabId => document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.classList.contains('active'), {}, setup.tabIds[0]);
            await page.evaluate(last => {
                document.querySelector(`.tab[data-tab-id="${last}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
            }, setup.tabIds[2]);

            expect((await page.$$eval('.tab.multi-selected', tabs => tabs.map(tab => Number(tab.dataset.tabId)))).sort())
                .toEqual([...setup.tabIds].sort());
            const selectionStyle = await page.$eval('.tab.multi-selected', tab => getComputedStyle(tab).boxShadow);
            expect(selectionStyle).toContain('inset');
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
            await page.waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches && [...document.querySelectorAll('.tab.multi-selected:not(.active)')].some(tab => getComputedStyle(tab).backgroundColor === 'rgb(56, 52, 61)'), { polling: 100, timeout: 5000 });
            const darkSelection = await page.$eval('.tab.multi-selected:not(.active)', tab => ({
                background: getComputedStyle(tab).backgroundColor,
                text: getComputedStyle(tab.querySelector('.tab-title-display')).color
            }));
            expect(darkSelection.background).toBe('rgb(56, 52, 61)');
            expect(darkSelection.text).toBe('rgb(236, 239, 241)');
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

            await page.$eval('.space.active .space-content', content => {
                content.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
            });
            expect(await page.$$eval('.tab.multi-selected', tabs => tabs.map(tab => Number(tab.dataset.tabId))))
                .toEqual([setup.tabIds[0]]);
            await page.$eval(`.tab[data-tab-id="${setup.tabIds[2]}"]`, tab => {
                tab.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
            });

            await page.$eval(`.tab[data-tab-id="${setup.tabIds[2]}"]`, tab => {
                tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
            });
            await page.waitForSelector('#tab-context-menu');
            expect(await page.$$eval('#tab-context-menu > .context-menu-item', items => items.map(item => item.childNodes[0].textContent.trim())))
                .toEqual(expect.arrayContaining([
                    'Add 3 Tabs to Favorites',
                    'Pin 3 Tabs',
                    'New Folder with 3 Items',
                    'Move 3 Tabs to Space',
                    'Archive 3 Tabs',
                    'Close 3 Tabs'
                ]));
            await page.evaluate(() => document.getElementById('tab-context-menu')?.remove());
            await page.waitForFunction(() => !document.getElementById('tab-context-menu'));
            await page.waitForFunction(count => document.querySelectorAll('.tab.multi-selected').length === count, {}, setup.tabIds.length);

            await page.evaluate(first => {
                const source = document.querySelector(`.tab[data-tab-id="${first}"]`);
                const dataTransfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
            }, setup.tabIds[0]);
            await page.waitForFunction(count => document.querySelectorAll('.tab.multi-dragging').length === count, {}, setup.tabIds.length);
            await page.evaluate(folderId => {
                const target = document.querySelector(`.folder[data-bookmark-id="${folderId}"] > .folder-header`);
                const dataTransfer = new DataTransfer();
                target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
            }, setup.folderId);

            await page.waitForFunction(async ({ folderId, tabIds, spaceId }) => {
                const children = await chrome.bookmarks.getChildren(folderId);
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(item => item.id === spaceId);
                return children.filter(node => node.url).length === tabIds.length
                    && tabIds.every(id => space?.spaceBookmarks.includes(id));
            }, { polling: 100 }, setup);

            await page.$eval(`.tab[data-tab-id="${setup.tabIds[0]}"]`, tab => {
                tab.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
            });

            const originalBookmarkOrder = await page.evaluate(async folderId =>
                (await chrome.bookmarks.getChildren(folderId)).map(node => node.url), setup.folderId);
            await page.$eval(`.tab[data-tab-id="${setup.tabIds[0]}"]`, tab => {
                tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
            });
            await page.waitForSelector('#tab-context-menu');
            expect(await page.$$eval('#tab-context-menu .context-menu-item', items => items.map(item => item.textContent.trim())))
                .toContain('Unpin 3 Tabs');
            await page.$$eval('#tab-context-menu .context-menu-item', items => {
                items.find(item => item.textContent.trim() === 'Unpin 3 Tabs').click();
            });
            await page.waitForFunction(async ({ folderId, tabIds, spaceId }) => {
                const children = await chrome.bookmarks.getChildren(folderId);
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(item => item.id === spaceId);
                return children.filter(node => node.url).length === 0
                    && tabIds.every(id => space?.temporaryTabs.includes(id));
            }, { polling: 100 }, setup);

            await page.waitForSelector('#undoToast .undo-toast-button', { timeout: 8000 });
            await page.$eval('#undoToast .undo-toast-button', button => button.click());
            await page.waitForFunction(async ({ folderId, tabIds, spaceId }) => {
                const children = await chrome.bookmarks.getChildren(folderId);
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(item => item.id === spaceId);
                return children.filter(node => node.url).length === tabIds.length
                    && tabIds.every(id => space?.spaceBookmarks.includes(id));
            }, { polling: 100, timeout: 8000 }, setup);
            expect(await page.evaluate(async folderId =>
                (await chrome.bookmarks.getChildren(folderId)).map(node => node.url), setup.folderId))
                .toEqual(originalBookmarkOrder);

            await page.waitForSelector(`.space.active .tab[data-tab-id="${setup.tabIds[0]}"]`);
            await page.evaluate(({ first, last }) => {
                document.querySelector(`.tab[data-tab-id="${first}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
                document.querySelector(`.tab[data-tab-id="${last}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
                document.querySelector(`.tab[data-tab-id="${last}"]`)
                    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
            }, { first: setup.tabIds[0], last: setup.tabIds[2] });
            await page.waitForSelector('#tab-context-menu');
            await page.$$eval('#tab-context-menu .context-menu-item', items => {
                items.find(item => item.textContent.trim() === 'New Folder with 3 Items').click();
            });
            await page.waitForFunction(async ({ spaceFolderId, tabIds }) => {
                const folders = (await chrome.bookmarks.getChildren(spaceFolderId)).filter(node => !node.url);
                for (const folder of folders) {
                    const children = await chrome.bookmarks.getChildren(folder.id);
                    if (children.filter(node => node.url).length === tabIds.length) return true;
                }
                return false;
            }, { polling: 100 }, setup);
            await page.waitForFunction(() => [...document.querySelectorAll('.space.active .folder .folder-name:not([disabled])')]
                .some(input => { const rect = input.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }), { polling: 100 });

            await page.keyboard.press('Escape');
            await page.evaluate(({ first, last }) => {
                document.querySelector(`.tab[data-tab-id="${first}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
                document.querySelector(`.tab[data-tab-id="${last}"]`)
                    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
                document.querySelector(`.tab[data-tab-id="${last}"]`)
                    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
            }, { first: setup.tabIds[0], last: setup.tabIds[2] });
            await page.waitForSelector('#tab-context-menu .submenu');
            await page.$$eval('#tab-context-menu .submenu > .context-menu-item', items => {
                items.find(item => item.textContent.trim() === 'Home').click();
            });
            await page.waitForFunction(async ({ tabIds, sourceSpaceId }) => {
                const { spaces } = await chrome.storage.local.get('spaces');
                const home = spaces.find(item => item.name === 'Home');
                const source = spaces.find(item => item.id === sourceSpaceId);
                return tabIds.every(id => home?.spaceBookmarks.includes(id))
                    && tabIds.every(id => !source?.temporaryTabs.includes(id) && !source?.spaceBookmarks.includes(id));
            }, { polling: 100 }, { tabIds: setup.tabIds, sourceSpaceId: setup.spaceId });
        } finally {
            await page.evaluate(async ({ tabIds, spaceFolderId }) => {
                try { await chrome.tabs.remove(tabIds); } catch (error) { /* already closed */ }
                for (const node of await chrome.bookmarks.getChildren(spaceFolderId)) {
                    if (!node.url) await chrome.bookmarks.removeTree(node.id);
                }
            }, setup);
            await page.close();
        }
    });

    test('bulk pin, native favorites, archive, and close apply to every selected tab', async () => {
        const spaceName = `Bulk actions ${Date.now()}`;
        page = await createSpace(browser, extensionId, spaceName, 'blue');
        const { spaceId } = await page.evaluate(async name => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            return { spaceId: spaces.find(space => space.name === name).id };
        }, spaceName);
        const createdIds = [];
        async function createTabs(label) {
            const ids = await page.evaluate(async ({ spaceId, label }) => {
                const ids = [];
                for (let i = 0; i < 3; i++) {
                    const tab = await chrome.tabs.create({ url: `data:text/html,${label}-${i}`, active: false });
                    await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId });
                    ids.push(tab.id);
                }
                return ids;
            }, { spaceId, label });
            createdIds.push(...ids);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector(`#spaceSwitcher button[data-space-id="${spaceId}"]`);
            await page.$eval(`#spaceSwitcher button[data-space-id="${spaceId}"]`, button => button.click());
            for (const id of ids) await page.waitForSelector(`.space.active .tab[data-tab-id="${id}"]`);
            return ids;
        }
        async function selectAndOpen(ids) {
            await page.$eval(`.space.active .tab[data-tab-id="${ids[0]}"]`, el =>
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
            await page.waitForFunction(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('active'), {}, ids[0]);
            await page.$eval(`.space.active .tab[data-tab-id="${ids[2]}"]`, el =>
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true })));
            await page.waitForFunction(ids => ids.every(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('multi-selected')), {}, ids);
            await page.$eval(`.space.active .tab[data-tab-id="${ids[2]}"]`, el =>
                el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
            await page.waitForSelector('#tab-context-menu');
        }
        async function choose(label) {
            await page.$$eval('#tab-context-menu .context-menu-item', (items, label) => {
                const item = items.find(item => item.textContent.trim() === label);
                if (!item) throw new Error(`Missing bulk action: ${label}`);
                item.click();
            }, label);
        }
        try {
            const ids = await createTabs('bulk-archive');
            await selectAndOpen(ids);
            await choose('Pin 3 Tabs');
            await page.waitForFunction(async ({ ids, spaceId }) => {
                const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
                const space = spaces.find(space => space.id === spaceId);
                return ids.every(id => space?.spaceBookmarks.includes(id) && pinnedTabStatesById[id]?.bookmarkId);
            }, { polling: 100 }, { ids, spaceId });
            await page.waitForFunction(ids => ids.every(id => document.querySelector(`.space.active [data-tab-type="pinned"] .tab[data-tab-id="${id}"]`)), { polling: 100 }, ids);
            await selectAndOpen(ids);
            await choose('Add 3 Tabs to Favorites');
            await page.waitForFunction(async ids => (await Promise.all(ids.map(id => chrome.tabs.get(id)))).every(tab => tab.pinned), { polling: 100 }, ids);
            await page.evaluate(ids => Promise.all(ids.map(id => chrome.tabs.update(id, { pinned: false }))), ids);
            await page.reload({ waitUntil: 'domcontentloaded' });
            for (const id of ids) await page.waitForSelector(`.space.active .tab[data-tab-id="${id}"]`);
            await selectAndOpen(ids);
            await choose('Archive 3 Tabs');
            await page.waitForFunction(async ids => (await Promise.all(ids.map(id => chrome.tabs.get(id).then(() => false, () => true)))).every(Boolean), { polling: 100 }, ids);
            const archived = await page.evaluate(async () => (await chrome.storage.local.get('archivedTabs')).archivedTabs || []);
            expect(archived.filter(tab => tab.url?.startsWith('data:text/html,bulk-archive-'))).toHaveLength(3);
            const closeIds = await createTabs('bulk-close');
            await selectAndOpen(closeIds);
            await choose('Close 3 Tabs');
            await page.waitForFunction(async ids => (await Promise.all(ids.map(id => chrome.tabs.get(id).then(() => false, () => true)))).every(Boolean), { polling: 100 }, closeIds);
        } finally {
            for (const id of createdIds) await page.evaluate(id => chrome.tabs.remove(id).catch(() => {}), id);
            await page.close();
        }
    }, 90000);


    test('mixed selected favorites and temporary tabs drag together without replacing favorite identities', async () => {
        const name = `Mixed drag ${Date.now()}`;
        page = await createSpace(browser, extensionId, name, 'green');
        const fixture = await page.evaluate(async name => {
            const { spaces } = await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'get' });
            const space = spaces.find(space => space.name === name);
            const folder = await chrome.bookmarks.create({ parentId: space.bookmarkFolderId, title: 'Mixed target' });
            const ids = [], bookmarkIds = [];
            for (let i = 0; i < 3; i++) {
                const url = `data:text/html,mixed-drag-${i}`;
                const tab = await chrome.tabs.create({ url, active: false });
                await chrome.runtime.sendMessage({ type: 'spaceStore', action: 'assign', tabId: tab.id, spaceId: space.id, pinned: i < 2 });
                if (i < 2) {
                    const bookmark = await chrome.bookmarks.create({ parentId: space.bookmarkFolderId, title: `Favorite ${i}`, url });
                    const { pinnedTabStatesById = {} } = await chrome.storage.local.get('pinnedTabStatesById');
                    pinnedTabStatesById[tab.id] = { bookmarkId: bookmark.id, pinnedUrl: url };
                    await chrome.storage.local.set({ pinnedTabStatesById });
                    bookmarkIds.push(bookmark.id);
                }
                ids.push(tab.id);
            }
            return { ids, bookmarkIds, spaceId: space.id, folderId: folder.id };
        }, name);
        try {
            await page.reload({ waitUntil: 'domcontentloaded' });
            for (const id of fixture.ids) await page.waitForSelector(`.space.active .tab[data-tab-id="${id}"]`);
            const ordered = await page.$$eval('.space.active .tab[data-tab-id]', (rows, ids) => rows.map(row => Number(row.dataset.tabId)).filter(id => ids.includes(id)), fixture.ids);
            expect(ordered).toHaveLength(3);
            await page.$eval(`.space.active .tab[data-tab-id="${ordered[0]}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
            await page.waitForFunction(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('active'), {}, ordered[0]);
            await page.$eval(`.space.active .tab[data-tab-id="${ordered.at(-1)}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true })));
            await page.waitForFunction(ids => ids.every(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('multi-selected')), {}, fixture.ids);
            await page.evaluate(({ sourceId, folderId }) => {
                const source = document.querySelector(`.space.active .tab[data-tab-id="${sourceId}"]`);
                const target = document.querySelector(`.space.active .folder[data-bookmark-id="${folderId}"] > .folder-header`);
                const dataTransfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
                source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
            }, { sourceId: ordered[0], folderId: fixture.folderId });
            await page.waitForFunction(async ({ ids, bookmarkIds, folderId, spaceId }) => {
                const children = await chrome.bookmarks.getChildren(folderId);
                const { spaces, pinnedTabStatesById = {} } = await chrome.storage.local.get(['spaces', 'pinnedTabStatesById']);
                const space = spaces.find(space => space.id === spaceId);
                return children.length === 3 && bookmarkIds.every(id => children.some(node => node.id === id))
                    && ids.every(id => space?.spaceBookmarks.includes(id) && pinnedTabStatesById[id]?.bookmarkId);
            }, { polling: 100, timeout: 10000 }, fixture);
            const savedOrder = await page.evaluate(async folderId => (await chrome.bookmarks.getChildren(folderId)).map(node => node.url), fixture.folderId);
            await page.waitForFunction(ids => ids.every(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)), { polling: 100 }, fixture.ids);
            const displayed = await page.$$eval('.space.active .tab[data-tab-id]', (rows, ids) => rows.map(row => Number(row.dataset.tabId)).filter(id => ids.includes(id)), fixture.ids);
            await page.$eval(`.space.active .tab[data-tab-id="${displayed[0]}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })));
            await page.waitForFunction(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('active'), {}, displayed[0]);
            await page.$eval(`.space.active .tab[data-tab-id="${displayed.at(-1)}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true })));
            await page.waitForFunction(ids => ids.every(id => document.querySelector(`.space.active .tab[data-tab-id="${id}"]`)?.classList.contains('multi-selected')), {}, fixture.ids);
            await page.evaluate(sourceId => {
                const source = document.querySelector(`.space.active .tab[data-tab-id="${sourceId}"]`);
                const target = document.querySelector('.space.active [data-tab-type="temporary"]');
                const dataTransfer = new DataTransfer();
                source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
                source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
            }, displayed[0]);
            await page.waitForFunction(async ({ ids, folderId, spaceId }) => {
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(space => space.id === spaceId);
                return (await chrome.bookmarks.getChildren(folderId)).length === 0 && ids.every(id => space?.temporaryTabs.includes(id));
            }, { polling: 100, timeout: 10000 }, fixture);
            await page.waitForSelector('#undoToast .undo-toast-button');
            await page.$eval('#undoToast .undo-toast-button', button => button.click());
            await page.waitForFunction(async ({ ids, folderId, spaceId }) => {
                const { spaces } = await chrome.storage.local.get('spaces');
                const space = spaces.find(space => space.id === spaceId);
                return (await chrome.bookmarks.getChildren(folderId)).length === 3 && ids.every(id => space?.spaceBookmarks.includes(id));
            }, { polling: 100, timeout: 10000 }, fixture);
            expect(await page.evaluate(async folderId => (await chrome.bookmarks.getChildren(folderId)).map(node => node.url), fixture.folderId)).toEqual(savedOrder);
        } finally {
            for (const id of fixture.ids) await page.evaluate(id => chrome.tabs.remove(id).catch(() => {}), id);
            await page.close();
        }
    }, 60000);

});
