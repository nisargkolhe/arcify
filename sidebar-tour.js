import { PRACTICE_LESSONS } from './tour-practice.js';
import { TOUR_KEY, TOUR_STEPS, tourAction, normalizeTour } from './tour-state.js';

export async function initSidebarTour() {
    const { id: windowId } = await chrome.windows.getCurrent();
    let state, latestState, baseline, frame, timer, observedTarget, lastStep;
    let transition, transitioning = false, revision = 0;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const panel = document.createElement('section');
    panel.id = 'arcify-tour'; panel.hidden = true;
    panel.setAttribute('aria-label', 'Arcify guided tour');
    panel.innerHTML = `<div class="coach-heading"><span id="coach-progress"></span><button id="coach-skip" type="button">Skip tour</button></div>
        <div id="coach-content" aria-live="polite"><h2 id="coach-title"></h2><p id="coach-copy"></p><p id="coach-feedback" role="status"></p></div>
        <button id="coach-retry" type="button" hidden>Add practice tab</button><div class="coach-navigation"><button id="coach-back" type="button">Back</button><button id="coach-next" type="button">Next tip</button></div>`;
    const ring = document.createElement('div'); ring.id = 'arcify-tour-ring'; ring.hidden = true; ring.setAttribute('aria-hidden', 'true');
    document.getElementById('sidebar-container').append(ring);
    document.querySelector('.new-tab-btn-container').before(panel);
    const el = id => document.getElementById(id);
    const activeSpace = () => [...document.querySelectorAll('#spacesList > .space')].find(space => space.style.display !== 'none');
    const measure = () => ({ spaceId: activeSpace()?.dataset.spaceId, color: activeSpace()?.querySelector('.space-color-select')?.value, spaces: document.querySelectorAll('#spacesList > .space').length,
        pins: document.querySelectorAll('.pinned-tabs .tab').length,
        folders: document.querySelectorAll('#spacesList .folder').length,
        favorites: document.querySelectorAll('#pinnedFavicons .pinned-favicon').length });
    const active = () => state?.status === 'active' && state.windowId === windowId;
    function locate() {
        if (!active()) return null;
        const step = TOUR_STEPS[state.step];
        if (!step.target) return null;
        if (step.id === 'spaces' && document.getElementById('addSpaceInputContainer').classList.contains('visible')) return document.getElementById('addSpaceInputContainer');
        if (step.id === 'pins') {
            const pins = activeSpace()?.querySelector('.pinned-tabs');
            const collapsed = !pins?.getBoundingClientRect().height;
            el('coach-copy').textContent = collapsed ? `Expand the pinned section with the highlighted arrow. ${step.tip}` : step.tip;
            if (collapsed) return activeSpace()?.querySelector('.space-toggle-chevron');
        }
        if (step.id === 'folders') {
            const folder = activeSpace()?.querySelector('.folder');
            if (folder) {
                el('coach-copy').textContent = 'Drag “Practice: file this tab” into the highlighted folder. Click the folder to expand it if needed.';
                return folder;
            }
            el('coach-copy').textContent = step.tip;
            const button = activeSpace()?.querySelector('.new-folder-btn');
            if (button?.getBoundingClientRect().height) return button;
        }
        if (step.id === 'color') {
            const palette = activeSpace()?.querySelector('.space-options-dropdown .color-picker-grid');
            if (palette?.getBoundingClientRect().height) return palette;
        }
        if (step.id === 'settings') {
            const button = activeSpace()?.querySelector('.settings-btn');
            if (button?.getBoundingClientRect().height) return button;
        }
        if (step.target.startsWith('.space ')) return activeSpace()?.querySelector(step.target.replace('.space ', ''));
        return document.querySelector(step.target);
    }
    function position() {
        frame = null;
        if (!active() || transitioning) return;
        const target = locate();
        if (observedTarget !== target) {
            if (observedTarget) resizeObserver.unobserve(observedTarget);
            observedTarget = target;
            if (target) resizeObserver.observe(target);
        }
        const rect = target?.getBoundingClientRect();
        ring.hidden = !rect || rect.height === 0;
        if (!ring.hidden) {
            const top = Math.max(3, rect.top - 3), bottom = Math.min(innerHeight - 3, rect.bottom + 3);
            Object.assign(ring.style, { top: `${top}px`, left: `${Math.max(3, rect.left - 3)}px`, width: `${Math.min(innerWidth - 6, rect.width + 6)}px`, height: `${Math.max(0, bottom - top)}px` });
        }
    }

    function schedule() { if (!frame && active() && !transitioning) frame = requestAnimationFrame(position); }
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(panel);
    async function render(next) {
        latestState = normalizeTour(next);
        const key = `${latestState?.runId}:${latestState?.step}:${latestState?.status}`;
        if (key === lastStep) {
            if (!transitioning) { state = latestState; checkProgress(); schedule(); }
            return;
        }
        lastStep = key;
        const token = ++revision;
        const focusedControl = panel.contains(document.activeElement) ? document.activeElement.id : null;
        clearTimeout(timer); timer = null;
        transition?.cancel();
        const nextActive = latestState?.status === 'active' && latestState.windowId === windowId;
        const animate = active() && nextActive && state.step !== latestState.step && !reducedMotion.matches && !document.hidden;
        transitioning = true;
        el('coach-back').disabled = el('coach-next').disabled = true;
        ring.hidden = true;
        const content = el('coach-content');
        if (animate) {
            transition = content.animate([
                { opacity: 1, transform: 'translateX(0)' },
                { opacity: 0, transform: 'translateX(-22px)' }
            ], { duration: 150, easing: 'ease-in', fill: 'forwards' });
            await transition.finished.catch(() => {});
            if (token !== revision) return;
        }
        transition?.cancel();
        state = latestState;
        panel.hidden = !active();
        document.getElementById('sidebar-container').dataset.tourStep = active() ? TOUR_STEPS[state.step].id : '';
        if (!active()) { transitioning = false; return; }
        const step = TOUR_STEPS[state.step];
        baseline = measure();
        el('coach-progress').textContent = `${state.step + 1} of ${TOUR_STEPS.length}`;
        el('coach-title').textContent = step.title;
        el('coach-copy').textContent = step.tip;
        el('coach-feedback').textContent = '';
        el('coach-retry').hidden = true;
        el('coach-next').textContent = state.step === TOUR_STEPS.length - 1 ? 'Start using Arcify' : 'Next tip';
        // Resolve contextual copy before fading in, then keep it stable during motion.
        locate();
        if (animate && !reducedMotion.matches && !document.hidden) {
            transition = content.animate([
                { opacity: 0, transform: 'translateX(22px)' },
                { opacity: 1, transform: 'translateX(0)' }
            ], { duration: 210, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
            await transition.finished.catch(() => {});
            if (token !== revision) return;
            transition.cancel();
        }
        state = latestState;
        transitioning = false;
        el('coach-back').disabled = state.step === 0;
        el('coach-next').disabled = false;
        if (focusedControl && document.activeElement === document.body && !el(focusedControl)?.disabled) el(focusedControl)?.focus();
        schedule();
        prepareTab();
    }
    async function prepareTab() {
        if (!active() || !PRACTICE_LESSONS.has(TOUR_STEPS[state.step].id)) return;
        const { runId, step } = state;
        try {
            await tourAction({ action: 'practice', runId, step });
            if (active() && state.runId === runId && state.step === step) el('coach-retry').hidden = true;
        } catch {
            if (active() && state.runId === runId && state.step === step) {
                el('coach-feedback').textContent = 'Couldn’t add a practice tab. Try again below.';
                el('coach-retry').hidden = false;
            }
        }
    }
    el('coach-retry').onclick = prepareTab;
    async function send(action) {
        try { await tourAction({ runId: state.runId, step: state.step, ...action }); }
        catch { el('coach-feedback').textContent = 'Couldn’t save progress. Try again.'; }
    }
    function achieved(message) {
        if (!active() || transitioning || timer) return;
        const { runId, step } = state;
        el('coach-feedback').textContent = message;
        timer = setTimeout(() => {
            timer = null;
            if (active() && state.runId === runId && state.step === step) send({ action: 'achieved' });
        }, 1400);
    }
    el('coach-back').onclick = () => send({ action: 'go', step: state.step - 1 });
    el('coach-next').onclick = () => send({ action: state.step === TOUR_STEPS.length - 1 ? 'finish' : 'next' });
    el('coach-skip').onclick = () => send({ action: 'stop' });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && active()) send({ action: 'stop' });
    });
    document.addEventListener('click', event => {
        if (!active() || panel.contains(event.target)) return;
        const id = TOUR_STEPS[state.step].id;
        if (id === 'archive' && event.target.closest('.sidebar-button')) achieved('Your archive is right here.');
        if (id === 'settings' && event.target.closest('.settings-btn')) achieved('Settings opened. Make yourself at home.');
        schedule();
    }, true);
    function checkProgress() {
        if (!active() || transitioning || !baseline) return;
        const id = TOUR_STEPS[state.step].id;
        const tabId = state.practiceTabs?.[id];
        const tab = tabId ? document.querySelector(`.tab[data-tab-id="${tabId}"]`) : null;
        if (id === 'spaces' && measure().spaces > baseline.spaces) achieved('Space created. Let’s make it yours.');
        if (id === 'pins' && tab?.closest('.pinned-tabs')) achieved('Pinned. This bookmark will stay.');
        if (id === 'folders' && tab?.closest('.folder')) achieved('Filed away. Click the folder to collapse it.');
        if (id === 'favorites' && tabId && document.querySelector(`#pinnedFavicons [data-tab-id="${tabId}"]`)) achieved('Added to Favorites. Available in every space.');
    }
    const observer = new MutationObserver(records => {
        if (!active() || records.every(record => panel.contains(record.target) || record.target === ring)) return;
        checkProgress();
        schedule();
    });
    observer.observe(document.getElementById('sidebar-container'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('pointerover', schedule, true);
    document.addEventListener('focusin', schedule, true);
    document.addEventListener('focusout', schedule, true);
    const onStorage = (changes, area) => {
        if (area !== 'local') return;
        if (changes[TOUR_KEY]) render(changes[TOUR_KEY].newValue);
        if (changes.spaces && active() && !transitioning && TOUR_STEPS[state.step].id === 'color') {
            const saved = changes.spaces.newValue?.find(space => space.id === baseline.spaceId);
            if (saved && activeSpace()?.dataset.spaceId === baseline.spaceId && saved.color !== baseline.color) {
                achieved('Color saved. This space has its own look.');
            }
        }
    };
    const updateMotion = () => {
        ring.style.setProperty('--tour-motion-state', document.hidden ? 'paused' : 'running');
        if ((document.hidden || reducedMotion.matches) && transition?.playState === 'running') transition.finish();
    };
    document.addEventListener('visibilitychange', updateMotion);
    reducedMotion.addEventListener('change', updateMotion);
    updateMotion();
    chrome.storage.onChanged.addListener(onStorage);
    render((await chrome.storage.local.get(TOUR_KEY))[TOUR_KEY]);
    window.addEventListener('pagehide', () => { ++revision; transition?.cancel(); clearTimeout(timer); cancelAnimationFrame(frame); observer.disconnect(); resizeObserver.disconnect(); chrome.storage.onChanged.removeListener(onStorage); }, { once: true });
}
