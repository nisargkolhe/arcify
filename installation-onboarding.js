import { TOUR_KEY, tourAction } from './tour-state.js';
const $ = id => document.getElementById(id);
let state, windowId, handedOff = false, paused = false;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
function updateMotion() {
    const stopped = paused || motion.matches || document.hidden || handedOff;
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
        const row = document.createElement('tr');
        [label, suggestion, commands.find(command => command.name === name)?.shortcut || 'Not assigned'].forEach((value, index) => {
            const cell = document.createElement(index ? 'td' : 'th');
            if (!index) cell.scope = 'row';
            const content = document.createElement(index === 1 ? 'kbd' : 'span');
            content.textContent = value; cell.append(content); row.append(cell);
        });
        $('shortcuts').append(row);
    }
}
async function initialize() {
    try {
        windowId = (await chrome.windows.getCurrent()).id;
        render((await chrome.storage.local.get(TOUR_KEY))[TOUR_KEY]);
        $('start').disabled = false;
        await loadShortcuts();
    } catch (error) { showError(error); }
}
window.addEventListener('focus', () => loadShortcuts().catch(showError));
initialize();
