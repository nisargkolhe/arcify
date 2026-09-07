import { TOUR_KEY, tourAction } from './tour-state.js';
import { readBookmarkSpaces } from './onboarding-bookmarks.js';
const $ = id => document.getElementById(id);
let bookmarkFolderId;
let setupStep = 0;
const setupPanels = ['step-bookmarks', 'step-placement', 'step-shortcuts'];
const stepButtons = [...document.querySelectorAll('[data-setup-step]')];
function showSetupStep(index, focus = true) {
    setupStep = Math.max(0, Math.min(setupPanels.length - 1, index));
    setupPanels.forEach((id, position) => { $(id).hidden = position !== setupStep; });
    stepButtons.forEach((button, position) => {
        if (position === setupStep) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
        button.classList.toggle('visited', position < setupStep);
    });
    const last = setupStep === setupPanels.length - 1;
    $('setup-back').hidden = setupStep === 0;
    $('setup-next').hidden = last;
    $('start').hidden = !last;
    $('practice-note').hidden = !last;
    $('setup-progress').textContent = `Step ${setupStep + 1} of ${setupPanels.length}`;
    if (focus) $(setupPanels[setupStep]).querySelector('h2').focus({ preventScroll: true });
    updateMotion();
}
let state, windowId, handedOff = false, paused = false;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
function updateMotion() {
    const stopped = paused || motion.matches || document.hidden || handedOff || setupStep !== 1;
    $('setup-gif').hidden = stopped;
    // Remove the animated source while stopped, so the GIF does not keep decoding.
    if (stopped) $('setup-gif').removeAttribute('src');
    else if (!$('setup-gif').hasAttribute('src')) $('setup-gif').src = 'assets/chrometutorial.gif';
    $('motion-still').hidden = !stopped;
    $('pause').textContent = motion.matches ? 'Motion reduced' : paused ? 'Play animation' : 'Pause animation';
    $('pause').disabled = motion.matches;
    $('pause').setAttribute('aria-pressed', String(paused || motion.matches));
}
function render(next) {
    state = next;
    if (state?.status === 'active' && state.windowId === windowId) handedOff = true;
    $('setup').hidden = handedOff;
    $('handoff').hidden = !handedOff;
    $('skip').hidden = handedOff;
    if (handedOff) {
        const finished = state?.status === 'completed';
        const skipped = state?.status === 'skipped';
        $('handoff-title').textContent = finished || skipped ? 'Make yourself at home.' : 'Continue the tutorial in your sidebar.';
        $('handoff-copy').textContent = finished || skipped ? 'Your sidebar is ready. Replay the tutorial anytime from Arcify Settings.' : 'Follow the highlights in Arcify. Everything you need, including practice tabs, is waiting there.';
    }
    updateMotion();
}
function showError(error) { $('error').hidden = false; $('error').textContent = `${error.message}. Try again, or open Arcify from its toolbar icon.`; }
$('setup-next').addEventListener('click', () => showSetupStep(setupStep + 1));
$('setup-back').addEventListener('click', () => showSetupStep(setupStep - 1));
stepButtons.forEach((button, index) => button.addEventListener('click', () => showSetupStep(index)));
$('start').addEventListener('click', async () => {
    $('error').hidden = true;
    try {
        // Chrome requires sidePanel.open to run directly within the click gesture.
        const opening = chrome.sidePanel.open({ windowId });
        await opening;
        render(await tourAction({ action: 'start', windowId, runId: crypto.randomUUID(), step: 0 }));
    } catch (error) { showError(error); }
});
$('reopen').addEventListener('click', () => chrome.sidePanel.open({ windowId }).catch(showError));
$('skip').addEventListener('click', async () => {
    try {
        await chrome.storage.sync.set({ onboardingCompleted: true });
        handedOff = true;
        render({ status: 'skipped' });
    } catch (error) { showError(error); }
});
$('pause').addEventListener('click', () => { paused = !paused; updateMotion(); });
document.addEventListener('visibilitychange', updateMotion);
motion.addEventListener('change', updateMotion);
$('appearance').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/appearance' }).catch(showError));
$('customize').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(showError));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[TOUR_KEY]) render(changes[TOUR_KEY].newValue); });
async function loadShortcuts() {
    const [commands, platform] = await Promise.all([chrome.commands.getAll(), chrome.runtime.getPlatformInfo()]);
    const mod = platform.os === 'mac' ? '⌘' : 'Ctrl';
    const recommendations = [
        ['_execute_action', 'Show / hide sidebar', `${mod}+S`],
        ['quickPinToggle', 'Pin / unpin a tab', platform.os === 'mac' ? '⌥+D' : 'Alt+D'],
        ['NextTabInSpace', 'Next tab in space', platform.os === 'mac' ? '⌥+J' : 'Alt+J'],
        ['PrevTabInSpace', 'Previous tab in space', platform.os === 'mac' ? '⌥+K' : 'Alt+K'],
        ['copyCurrentUrl', 'Copy current URL', `${mod}+Shift+C`]
    ];
    $('shortcuts').replaceChildren();
    for (const [name, label, suggestion] of recommendations) {
        const card = document.createElement('li');
        card.className = 'shortcut-card';
        const recommendation = document.createElement('span');
        recommendation.className = 'shortcut-label';
        recommendation.textContent = 'Recommended';
        const key = document.createElement('kbd');
        key.className = 'shortcut-key';
        key.textContent = suggestion;
        const title = document.createElement('h3');
        title.className = 'shortcut-title';
        title.textContent = label;
        const current = document.createElement('p');
        current.className = 'shortcut-description';
        current.textContent = `Currently set: ${commands.find(command => command.name === name)?.shortcut || 'Not assigned'}`;
        card.append(recommendation, key, title, current);
        $('shortcuts').append(card);
    }
}
async function loadBookmarkSpaces() {
    try {
        const { folderId, names } = await readBookmarkSpaces();
        bookmarkFolderId = folderId;
        $('bookmark-title').textContent = names.length
            ? `We found ${names.length === 1 ? 'an existing space' : `${names.length} existing spaces`}.`
            : 'Bring your bookmarks along.';
        $('bookmark-copy').textContent = names.length
            ? "The folders in your Arcify bookmarks are ready to become spaces, with their bookmarks as pinned tabs. Copy more folders into Arcify anytime."
            : "In Chrome's bookmark manager, copy folders into the Arcify folder. Each folder becomes a space, and the bookmarks inside become pinned tabs.";
        if (!folderId) $('bookmark-copy').textContent += ' Create a folder named Arcify first if it is missing.';
        $('bookmark-detected').hidden = !names.length;
        $('bookmark-detected').textContent = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` · and ${names.length - 3} more` : '');
        $('bookmarks').textContent = folderId ? 'Open Arcify bookmarks ↗' : 'Open bookmark manager ↗';
    } catch {
        // Optional discovery must not block setup or claim spaces were detected.
        bookmarkFolderId = undefined;
        $('bookmark-title').textContent = 'Bring your bookmarks along.';
        $('bookmark-copy').textContent = "Open Chrome's bookmark manager and copy folders into the Arcify folder. Each folder becomes a space, and its bookmarks become pinned tabs. If Arcify isn't there yet, create a folder named Arcify first.";
        $('bookmark-detected').hidden = true;
        $('bookmarks').textContent = 'Open bookmark manager ↗';
    }
}
$('bookmarks').addEventListener('click', () => chrome.tabs.create({
    url: bookmarkFolderId ? `chrome://bookmarks/?id=${encodeURIComponent(bookmarkFolderId)}` : 'chrome://bookmarks/'
}).catch(showError));
async function initialize() {
    try {
        windowId = (await chrome.windows.getCurrent()).id;
        render((await chrome.storage.local.get(TOUR_KEY))[TOUR_KEY]);
        $('start').disabled = false;
        await Promise.all([loadShortcuts(), loadBookmarkSpaces()]);
    } catch (error) { showError(error); }
}
window.addEventListener('focus', () => { loadShortcuts().catch(showError); loadBookmarkSpaces(); });
initialize();
