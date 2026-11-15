const lesson = new URLSearchParams(location.hash.slice(1)).get('lesson');
const lessons = {
    pins: ['Practice: pin this tab', 'A keeper.', 'Drag this tab above the divider in your sidebar. Its bookmark will stay, even after you close it.'],
    folders: ['Practice: file this tab', 'Better together.', 'Drag this tab into a folder in your sidebar. A little organization goes a long way.'],
    favorites: ['Practice: favorite this tab', 'Always close by.', 'Drag this tab into Favorites at the top of your sidebar. It will be available in every space.'],
    split: ['Practice: start a split', 'Side by side.', 'Right-click this tab in Arcify and choose Add Tab to New Split View. Then select the other practice tab.'],
    'split-companion': ['Practice: join the split', 'Ready to join.', 'Choose this tab in the split-view picker to place it beside the first practice tab.'],
    archive: ['Practice: archive this tab', 'Save it for later.', 'Right-click this tab in your sidebar and choose Archive Tab. Open Archived Tabs to bring it back.']
};
if (lessons[lesson]) {
    const [title, heading, copy] = lessons[lesson];
    document.title = title;
    document.getElementById('practice-title').textContent = heading;
    document.getElementById('practice-copy').textContent = copy;
}
