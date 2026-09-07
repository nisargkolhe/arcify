export async function spaceRequest(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'spaceStore', action, ...payload });
    if (!response?.success) throw new Error(response?.error || 'Space storage unavailable');
    return response.spaces;
}

export async function getSpaceTabs(spaceId) {
    const { spaces = [] } = await chrome.storage.local.get('spaces');
    const space = spaces.find(s => s.id === spaceId);
    const tabs = new Map((await chrome.tabs.query({})).map(t => [t.id, t]));
    return [...(space?.spaceBookmarks || []), ...(space?.temporaryTabs || [])].map(id => tabs.get(id)).filter(Boolean);
}
