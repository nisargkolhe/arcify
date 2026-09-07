// Optional, one-way projection. This is the only module allowed to mutate groups.
// Space identity and ordering never depend on the projection succeeding.
export async function syncSpaceGroups(spaces, activeSpaces = {}) {
    const { syncTabGroups = false } = await chrome.storage.sync.get('syncTabGroups');
    if (!syncTabGroups) return;
    const { spaceGroupProjection = {} } = await chrome.storage.session.get('spaceGroupProjection');
    const groups = await chrome.tabGroups.query({});
    const tabs = await chrome.tabs.query({});
    const byId = new Map(tabs.map(t => [t.id, t]));
    const next = {};
    for (const space of spaces) {
        const members = [...space.spaceBookmarks, ...space.temporaryTabs].map(id => byId.get(id)).filter(t => t && !t.pinned);
        const windows = [...new Set(members.map(t => t.windowId))];
        for (const windowId of windows) {
            // Recheck between spaces so disabling the setting stops a long projection.
            if (!(await chrome.storage.sync.get('syncTabGroups')).syncTabGroups) return;
            const key = `${space.id}:${windowId}`;
            const ordered = members.filter(t => t.windowId === windowId);
            const ids = ordered.map(t => t.id);
            let groupId = spaceGroupProjection[key];
            const liveGroup = groups.find(g => g.id === groupId && g.windowId === windowId);
            if (!liveGroup) groupId = undefined;
            if (groupId === undefined || ordered.some(t => t.groupId !== groupId)) {
                groupId = await chrome.tabs.group({ tabIds: ids, ...(groupId === undefined ? { createProperties: { windowId } } : { groupId }) });
            }
            next[key] = groupId;
            const collapsed = Boolean(activeSpaces[windowId] && activeSpaces[windowId] !== space.id);
            if (!liveGroup || liveGroup.title !== space.name || liveGroup.color !== space.color || liveGroup.collapsed !== collapsed) {
                await chrome.tabGroups.update(groupId, { title: space.name, color: space.color, collapsed });
            }
            const current = await chrome.tabs.query({ groupId });
            current.sort((a, b) => a.index - b.index);
            if (current.length === ids.length && current.some((t, i) => t.id !== ids[i])) {
                await chrome.tabs.move(ids, { index: current[0].index });
            }
        }
    }
    await chrome.storage.session.set({ spaceGroupProjection: next });
}
