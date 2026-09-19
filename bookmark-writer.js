let chain = Promise.resolve();

function sameIds(a, b) {
    return a.length === b.length && a.every(id => b.includes(id));
}

async function apply({ parentId, displayIds, inverted }) {
    const desired = (inverted ? [...displayIds].reverse() : [...displayIds]).map(String);
    let live = (await chrome.bookmarks.getChildren(parentId)).map(node => String(node.id));
    if (!sameIds(live, desired)) {
        throw new Error('Bookmark order changed while this drag was being saved. Refresh and retry.');
    }
    for (let index = 0; index < desired.length; index++) {
        if (live[index] === desired[index]) continue;
        await chrome.bookmarks.move(desired[index], { parentId, index });
        const next = (await chrome.bookmarks.getChildren(parentId)).map(node => String(node.id));
        const expected = [...live];
        expected.splice(expected.indexOf(desired[index]), 1);
        expected.splice(index, 0, desired[index]);
        if (JSON.stringify(next) !== JSON.stringify(expected)) {
            throw new Error('Bookmark order changed concurrently. Refresh and retry.');
        }
        live = next;
    }
    return live;
}

export function enqueueBookmarkOrder(request) {
    const run = chain.then(() => apply(request));
    chain = run.catch(() => {});
    return run;
}
