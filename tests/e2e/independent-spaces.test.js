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
            await chrome.storage.sync.set({ syncTabGroups: true });
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
            }))).toEqual({ text: 'New Subfolder', disabled: false });

            await page.evaluate(() => document.querySelector('.folder-context-menu')?.remove());
            const nestedTabTitle = `${parentSelector} > .folder-content > .tab[data-bookmark-id="${parent.nestedTabId}"] .tab-title-display`;
            await page.click(`${parentSelector} > .folder-header`);
            await page.waitForSelector(nestedTabTitle, { visible: true });
            await page.click(nestedTabTitle, { button: 'right' });
            await page.waitForSelector('#tab-context-menu');
            expect(await page.$('.folder-context-menu')).toBeNull();
            await page.evaluate(() => document.getElementById('tab-context-menu')?.remove());

            await page.click(`${parentSelector} > .folder-header`, { button: 'right' });
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

            await page.click(`${childSelector} > .folder-header`, { button: 'right' });
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
            await page.click(`${grandchildSelector} > .folder-header`, { button: 'right' });
            await page.waitForSelector('.folder-context-menu');
            expect(await page.$eval('.folder-context-menu .context-menu-item', item => item.disabled)).toBe(true);
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
            await page.waitForSelector('.folder .folder-name:not([disabled])', { visible: true });

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
                return tabIds.every(id => home?.temporaryTabs.includes(id))
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
});
