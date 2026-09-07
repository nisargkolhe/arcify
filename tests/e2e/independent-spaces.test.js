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
});
