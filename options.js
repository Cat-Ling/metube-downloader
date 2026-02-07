
const DEFAULT_METUBE_URL = 'http://localhost:8081';

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['metubeUrl'], (items) => {
        document.getElementById('metube-url').value = items.metubeUrl || DEFAULT_METUBE_URL;
    });
});

document.getElementById('save-btn').addEventListener('click', () => {
    let url = document.getElementById('metube-url').value.trim();

    if (url && !url.startsWith('http')) {
        url = 'http://' + url;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    chrome.storage.sync.set({ metubeUrl: url }, () => {
        document.getElementById('metube-url').value = url;
        const status = document.getElementById('status');
        status.classList.add('show');
        setTimeout(() => {
            status.classList.remove('show');
        }, 2000);
    });
});
