import { preparePractice } from './tour-practice.js';
export const TOUR_KEY = 'sidebarTourV2';
export const TOUR_STEPS = [
    { id: 'spaces', label: 'Spaces', title: 'Make room for a new space',
      tip: 'Click the highlighted +, give your space a name, then Create. Work, personal, or something entirely your own.',
      caption: 'Separate work and life. Switch spaces from the bottom of your sidebar.',
      detail: 'Edit the space name to rename it. Options changes its color; drag the space buttons to reorder them. Spaces stay saved after their last tab closes. Existing Chrome groups can be imported from the optional Create spaces notice.',
      target: '.space-switcher-container' },
    { id: 'color', label: 'Space color', title: 'Give your space a color',
      tip: 'Open the highlighted Options menu and choose a different color from the swatches. Your sidebar and its tutorial will follow along.',
      target: '.space .space-options' },
    { id: 'pins', label: 'Pinned tabs', title: 'Drag it up. Keep it close.',
      tip: 'We added “Practice: pin this tab” below. Drag it above the divider, or right-click it → Pin Tab.',
      caption: 'Drag a tab above the divider. Its bookmark stays, even after you close the tab.',
      detail: 'Click tabs to switch, drag to reorder, or right-click → Move to Space. New Tab opens in your active space. Double-click a pinned title to rename it. The tab menu can replace its saved URL after navigation; Unpin Tab returns it to the temporary list.',
      target: '.space .pinned-tabs' },
    { id: 'folders', label: 'Folders', title: 'Keep a project together',
      tip: 'Open Options → New Folder and give it a name. We added “Practice: file this tab” for you to drag inside.',
      caption: 'Drop related tabs into a folder. Collapse it when you need a little more room.',
      detail: 'Click a folder to expand or collapse it. With Chrome tab group sync off, right-click a top-level folder → New Folder to add one child level. Settings controls whether collapsed folders show all open tabs or just the active one.',
      target: '.space .space-options' },
    { id: 'favorites', label: 'Favorites', title: 'Your everyday sites, everywhere',
      tip: 'Drag “Practice: favorite this tab” into the highlighted area, or right-click it → Add to Favorites. It will follow you into every space.',
      caption: 'Put your everyday sites at the top. Favorites follow you into every space.',
      detail: 'Favorites are shared across spaces. Drag one back into a space to remove it from Favorites. Pinned tabs, by contrast, belong to a single space.',
      target: '#pinnedFavicons' },
    { id: 'archive', label: 'Archive', title: 'A fresh space, a way back',
      tip: 'Right-click “Practice: archive this tab” → Archive Tab. Then open the highlighted history button and click the entry to restore it.',
      caption: 'Archive a tab for later, then bring it back with a click.',
      detail: 'Manual archives remain accessible with auto-archiving off. Enable automatic cleanup in Settings and choose an inactivity interval; pinned tabs and tabs playing audio stay open. Clean All closes temporary tabs in the current space.',
      target: '.space .sidebar-button' },
    { id: 'settings', label: 'Your preferences', title: 'Make Arcify feel like you',
      tip: 'Open the highlighted Options menu → Settings for colors, tab order, automatic cleanup, and Chrome group sync.',
      caption: 'Your colors. Your shortcuts. Your way of keeping things organized.',
      detail: 'Settings includes default space, tab order, collapsed-folder behavior, auto-archiving, custom colors, and Advanced debug logging. Optional Chrome group sync mirrors Arcify’s spaces; Arcify stays authoritative. Turning sync off leaves Chrome groups unchanged.',
      target: '.space .space-options' }
];

export function normalizeTour(state) {
    if (!state || state.version === 3) return state;
    const oldIds = ['spaces', 'pins', 'folders', 'favorites', 'archive', 'settings'];
    return { ...state, version: 3, step: Math.max(0, TOUR_STEPS.findIndex(step => step.id === oldIds[state.step])) };
}

export function reduceTour(previous, action) {
    previous = normalizeTour(previous);
    if (action.action === 'start') return {
        version: 3, status: 'active', step: Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.trunc(Number(action.step) || 0))),
        windowId: action.windowId, runId: action.runId, completed: []
    };
    if (!previous || previous.runId !== action.runId || previous.status !== 'active') return previous;
    if (action.action === 'stop') return { ...previous, status: 'skipped' };
    if (action.action === 'go') return { ...previous, step: Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.trunc(Number(action.step) || 0))) };
    if (action.action === 'next' || action.action === 'achieved') {
        if (action.step !== previous.step) return previous; // Ignore stale/double-clicked events.
        const completed = action.action === 'achieved' ? [...new Set([...previous.completed, TOUR_STEPS[previous.step].id])] : previous.completed;
        return { ...previous, completed, step: Math.min(previous.step + 1, TOUR_STEPS.length - 1),
            status: previous.step === TOUR_STEPS.length - 1 ? 'completed' : 'active' };
    }
    return previous;
}

export function registerTourMessages() {
    let queue = Promise.resolve();
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (message.type !== 'sidebarTour') return;
        const operation = queue.catch(() => {}).then(async () => {
            const previous = normalizeTour((await chrome.storage.local.get(TOUR_KEY))[TOUR_KEY]);
            const state = message.action === 'practice'
                ? await preparePractice(previous, message, TOUR_STEPS) : reduceTour(previous, message);
            if (state) {
                await chrome.storage.local.set({ [TOUR_KEY]: state });
                if (state.status !== 'active') await chrome.storage.sync.set({
                    onboardingCompleted: true,
                    onboardingVersion: chrome.runtime.getManifest().version
                });
            }
            return state;
        });
        queue = operation;
        operation.then(state => reply({ success: true, state }), error => reply({ success: false, error: error.message }));
        return true;
    });
}
export async function tourAction(action) {
    const response = await chrome.runtime.sendMessage({ type: 'sidebarTour', ...action });
    if (!response?.success) throw new Error(response?.error || 'Tour could not be saved');
    return response.state;
}
