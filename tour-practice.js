export const PRACTICE_LESSONS = new Set(['pins', 'folders', 'favorites', 'archive', 'split']);
export function isPracticeUrl(url) {
    const base = globalThis.chrome?.runtime?.getURL?.('tutorial-practice.html');
    return Boolean(base && (url === base || url?.startsWith(`${base}#`)));
}
export function practiceUrl(runId, lesson) {
    return `${chrome.runtime.getURL('tutorial-practice.html')}#${new URLSearchParams({ run: runId, lesson })}`;
}
export async function cleanupPracticeTabs(state) {
    const ids = new Set(Object.values(state?.practiceTabs || {}).filter(id => Number.isInteger(id)));
    if (!ids.size) return [];
    const tabs = await chrome.tabs.query({ windowId: state.windowId });
    const practiceIds = tabs
        .filter(tab => ids.has(tab.id) && isPracticeUrl(tab.url || tab.pendingUrl))
        .map(tab => tab.id);
    for (const id of practiceIds) await chrome.tabs.remove(id);
    return practiceIds;
}
// Called from the serialized tour queue, so reopening a panel cannot create duplicates.
export async function preparePractice(state, message, steps) {
    if (state?.status !== 'active' || state.runId !== message.runId || state.step !== message.step) return state;
    const lesson = steps[state.step].id;
    if (!PRACTICE_LESSONS.has(lesson)) return state;
    if (lesson === 'split' && typeof chrome.tabs.createSplit !== 'function') return state;
    const lessons = lesson === 'split' ? ['split', 'split-companion'] : [lesson];
    const tabs = await chrome.tabs.query({ windowId: state.windowId });
    const practiceTabs = { ...state.practiceTabs };
    const createdTabs = {};
    try {
        for (const practiceLesson of lessons) {
            const url = practiceUrl(state.runId, practiceLesson);
            let tab = tabs.find(tab => (tab.url || tab.pendingUrl) === url);
            if (!tab) {
                tab = await chrome.tabs.create({ windowId: state.windowId, url, active: false });
                createdTabs[practiceLesson] = tab.id;
            }
            practiceTabs[practiceLesson] = tab.id;
        }
    } catch (error) {
        // A failed multi-tab setup must not leave an untracked practice tab behind.
        await cleanupPracticeTabs({ windowId: state.windowId, practiceTabs: createdTabs }).catch(() => {});
        throw error;
    }
    return { ...state, practiceTabs };
}
