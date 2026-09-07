export const PRACTICE_LESSONS = new Set(['pins', 'folders', 'favorites', 'archive']);
export function isPracticeUrl(url) {
    const base = globalThis.chrome?.runtime?.getURL?.('tutorial-practice.html');
    return Boolean(base && (url === base || url?.startsWith(`${base}#`)));
}
export function practiceUrl(runId, lesson) {
    return `${chrome.runtime.getURL('tutorial-practice.html')}#${new URLSearchParams({ run: runId, lesson })}`;
}
// Called from the serialized tour queue, so reopening a panel cannot create duplicates.
export async function preparePractice(state, message, steps) {
    if (state?.status !== 'active' || state.runId !== message.runId || state.step !== message.step) return state;
    const lesson = steps[state.step].id;
    if (!PRACTICE_LESSONS.has(lesson)) return state;
    const url = practiceUrl(state.runId, lesson);
    const tabs = await chrome.tabs.query({ windowId: state.windowId });
    const tab = tabs.find(tab => (tab.url || tab.pendingUrl) === url)
        || await chrome.tabs.create({ windowId: state.windowId, url, active: false });
    return { ...state, practiceTabs: { ...state.practiceTabs, [lesson]: tab.id } };
}
