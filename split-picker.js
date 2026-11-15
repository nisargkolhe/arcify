const params = new URLSearchParams(location.search);
const token = params.get('token');
const channel = new BroadcastChannel('arcify-split-picker');
const search = document.querySelector('#search');
const list = document.querySelector('#tabs');
const status = document.querySelector('#status');
const recovery = document.querySelector('#recovery');
let candidates = [];
let busy = false;
let ready = false;

function send(action, extra = {}) { channel.postMessage({ token, action, ...extra }); }
function closePicker() {
    send('cancel');
    setTimeout(() => window.close(), 150);
}
channel.addEventListener('message', ({ data }) => {
    if (data?.token !== token) return;
    if (data.action === 'tabs') {
        recovery.hidden = true;
        ready = true;
        candidates = data.tabs;
        render();
    } else if (data.action === 'error') {
        status.textContent = data.error;
        busy = false;
    }
});
const handshake = setInterval(() => { if (ready) clearInterval(handshake); else send('ready'); }, 300);
send('ready');
setTimeout(() => { if (!ready) recovery.hidden = false; }, 4000);

document.querySelector('#cancel').addEventListener('click', closePicker);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePicker();
    if (event.key === 'ArrowDown' && document.activeElement === search) {
        const first = list.querySelector('button');
        if (first) { event.preventDefault(); first.focus(); }
    }
});
search.addEventListener('input', render);

function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = candidates.filter(tab => `${tab.title || ''} ${tab.url || ''}`.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    status.textContent = matches.length ? '' : query ? 'No matching tabs.' : 'No other available tabs in this space.';
    for (const tab of matches) {
        const button = document.createElement('button');
        button.className = 'tab';
        button.type = 'button';
        button.dataset.tabId = tab.id;
        const icon = document.createElement('img');
        icon.className = 'favicon';
        icon.alt = '';
        icon.src = tab.favIconUrl || 'assets/default_icon.png';
        icon.onerror = () => { icon.onerror = null; icon.src = 'assets/default_icon.png'; };
        const text = document.createElement('span');
        text.className = 'tab-text';
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || tab.url || 'Untitled tab';
        const url = document.createElement('span');
        url.className = 'tab-url';
        url.textContent = tab.url || '';
        text.append(title, url);
        button.append(icon, text);
        button.addEventListener('click', async () => {
            if (busy) return;
            busy = true;
            recovery.hidden = true;
            status.textContent = 'Opening split view…';
            send('choose', { targetId: tab.id });
            setTimeout(() => {
                if (busy) {
                    busy = false;
                    status.textContent = '';
                    recovery.hidden = false;
                }
            }, 4000);
        });
        list.appendChild(button);
    }
}
