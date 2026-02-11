
const DEFAULT_METUBE_URL = 'http://localhost:8081';

const FORMATS = [
    {
        id: 'any',
        text: 'Any',
        qualities: [
            { id: 'best', text: 'Best' },
            { id: '2160', text: '2160p' },
            { id: '1440', text: '1440p' },
            { id: '1080', text: '1080p' },
            { id: '720', text: '720p' },
            { id: '480', text: '480p' },
            { id: '360', text: '360p' },
            { id: '240', text: '240p' },
            { id: 'worst', text: 'Worst' },
            { id: 'audio', text: 'Audio Only' },
        ]
    },
    {
        id: 'mp4',
        text: 'MP4',
        qualities: [
            { id: 'best', text: 'Best' },
            { id: 'best_ios', text: 'Best (iOS)' },
            { id: '2160', text: '2160p' },
            { id: '1440', text: '1440p' },
            { id: '1080', text: '1080p' },
            { id: '720', text: '720p' },
            { id: '480', text: '480p' },
            { id: '360', text: '360p' },
            { id: '240', text: '240p' },
            { id: 'worst', text: 'Worst' },
        ]
    },
    {
        id: 'm4a',
        text: 'M4A',
        qualities: [
            { id: 'best', text: 'Best' },
            { id: '192', text: '192 kbps' },
            { id: '128', text: '128 kbps' },
        ]
    },
    {
        id: 'mp3',
        text: 'MP3',
        qualities: [
            { id: 'best', text: 'Best' },
            { id: '320', text: '320 kbps' },
            { id: '192', text: '192 kbps' },
            { id: '128', text: '128 kbps' },
        ]
    },
    {
        id: 'opus',
        text: 'OPUS',
        qualities: [{ id: 'best', text: 'Best' }]
    },
    {
        id: 'wav',
        text: 'WAV',
        qualities: [{ id: 'best', text: 'Best' }]
    },
    {
        id: 'flac',
        text: 'FLAC',
        qualities: [{ id: 'best', text: 'Best' }]
    },
    {
        id: 'thumbnail',
        text: 'Thumbnail',
        qualities: [{ id: 'best', text: 'Best' }]
    }
];
let socket = null;
let currentDownloads = new Map();
let savedSettings = {};

document.addEventListener('DOMContentLoaded', async () => {
    const defaults = {
        metubeUrl: DEFAULT_METUBE_URL,
        quality: 'best',
        format: 'any',
        folder: '',
        customNamePrefix: '',
        playlistItemLimit: '',
        autoStart: true,
        splitByChapters: false,
        chapterTemplate: ''
    };

    const settings = await chrome.storage.sync.get(Object.keys(defaults));
    savedSettings = { ...defaults, ...settings };

    const metubeUrl = savedSettings.metubeUrl;

    document.getElementById('folder-input').value = savedSettings.folder;
    document.getElementById('prefix-input').value = savedSettings.customNamePrefix;
    document.getElementById('limit-input').value = savedSettings.playlistItemLimit;
    document.getElementById('autostart-check').checked = savedSettings.autoStart;
    document.getElementById('chapters-check').checked = savedSettings.splitByChapters;
    document.getElementById('chapter-template').value = savedSettings.chapterTemplate;

    document.getElementById('chapter-template-container').style.display = savedSettings.splitByChapters ? 'block' : 'none';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        document.getElementById('url-input').value = tab.url;
    }

    populateFormats(savedSettings.format);
    populateQualities(savedSettings.format, savedSettings.quality);

    setupChangeListeners();

    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedPanel = document.getElementById('advanced-panel');
    const toggleIcon = advancedToggle.querySelector('svg');

    advancedToggle.addEventListener('click', () => {
        advancedPanel.classList.toggle('show');
        const isShown = advancedPanel.classList.contains('show');
        toggleIcon.style.transform = isShown ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    document.getElementById('settings-btn').addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    });

    const openWebUiBtn = document.getElementById('open-web-ui-btn');
    if (openWebUiBtn) {
        openWebUiBtn.addEventListener('click', () => {
            // Mobile fallback: Open in new tab for better UX
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

            if (isMobile) {
                chrome.tabs.create({ url: metubeUrl });
            } else {
                const width = Math.round(window.screen.availWidth * 0.85);
                const height = Math.round(window.screen.availHeight * 0.85);
                const left = Math.round((window.screen.availWidth - width) / 2);
                const top = Math.round((window.screen.availHeight - height) / 2);

                chrome.windows.create({
                    url: metubeUrl,
                    type: 'popup',
                    width: width,
                    height: height,
                    left: left,
                    top: top
                });
            }
        });
    }

    const chaptersCheck = document.getElementById('chapters-check');
    const chapterTemplateContainer = document.getElementById('chapter-template-container');

    chaptersCheck.addEventListener('change', () => {
        chapterTemplateContainer.style.display = chaptersCheck.checked ? 'block' : 'none';
    });

    document.getElementById('tool-import').addEventListener('click', openImportModal);
    document.getElementById('tool-export').addEventListener('click', () => exportUrls(metubeUrl));
    document.getElementById('tool-copy').addEventListener('click', () => copyUrls(metubeUrl));

    const importModal = document.getElementById('import-modal');
    document.getElementById('import-cancel').addEventListener('click', () => {
        importModal.style.display = 'none';
        document.getElementById('import-text').value = '';
    });
    document.getElementById('import-confirm').addEventListener('click', () => startBatchImport(metubeUrl));

    function openImportModal() {
        importModal.style.display = 'flex';
        document.getElementById('import-text').focus();
    }

    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', async () => {
        const url = document.getElementById('url-input').value;
        if (!url) return;

        const quality = document.getElementById('quality-select').value;
        const format = document.getElementById('format-select').value;
        const folder = document.getElementById('folder-input').value;
        const prefix = document.getElementById('prefix-input').value;
        const limit = document.getElementById('limit-input').value;
        const autoStart = document.getElementById('autostart-check').checked;
        const splitChapters = document.getElementById('chapters-check').checked;
        const chapterTemplate = document.getElementById('chapter-template').value;

        if (splitChapters && !chapterTemplate.includes('%(section_number)')) {
            showToast('Chapter template must include %(section_number)');
            return;
        }

        const options = {
            url: url,
            quality: quality,
            format: format,
            folder: folder,
            custom_name_prefix: prefix,
            playlist_item_limit: limit ? parseInt(limit) : 0,
            auto_start: autoStart,
            split_by_chapters: splitChapters,
            chapter_template: chapterTemplate
        };

        setLoading(true);
        try {
            await addDownload(metubeUrl, options);
            showToast('Download Added!');
            document.getElementById('url-input').value = '';
        } catch (error) {
            const msg = error.message === 'Failed to fetch' ? 'Could not connect to MeTube server' : error.message;
            showToast('Error: ' + msg);
        } finally {
            setLoading(false);
        }
    });

    const batchRetryBtn = document.getElementById('batch-retry-btn');
    const batchClearBtn = document.getElementById('batch-clear-btn');

    batchRetryBtn.addEventListener('click', () => batchRetry(metubeUrl));
    batchClearBtn.addEventListener('click', () => batchClear(metubeUrl));

    initSocket(metubeUrl);
});

async function startBatchImport(baseUrl) {
    const text = document.getElementById('import-text').value;
    const urls = text.split(/\r?\n/).map(u => u.trim()).filter(u => u.length > 0);

    if (urls.length === 0) {
        showToast('No URLs found');
        return;
    }

    const modal = document.getElementById('import-modal');
    modal.style.display = 'none';
    document.getElementById('import-text').value = '';

    const quality = document.getElementById('quality-select').value;
    const format = document.getElementById('format-select').value;
    const folder = document.getElementById('folder-input').value;
    const prefix = document.getElementById('prefix-input').value;
    const limit = document.getElementById('limit-input').value;
    const autoStart = document.getElementById('autostart-check').checked;
    const splitChapters = document.getElementById('chapters-check').checked;
    const chapterTemplate = document.getElementById('chapter-template').value;

    showToast(`Importing ${urls.length} URLs...`);

    for (const url of urls) {
        try {
            await addDownload(baseUrl, {
                url: url,
                quality: quality,
                format: format,
                folder: folder,
                custom_name_prefix: prefix,
                playlist_item_limit: limit ? parseInt(limit) : 0,
                auto_start: autoStart,
                split_by_chapters: splitChapters,
                chapter_template: chapterTemplate
            });
        } catch (e) {
            console.error('Import error', e);
            const msg = e.message === 'Failed to fetch' ? 'Connection failed' : e.message;
            showToast(`Error: ${msg}`);
        }
    }
    showToast('Batch import finished');
}

function getVisibleUrls() {
    return Array.from(currentDownloads.values()).map(d => d.url);
}

function exportUrls(baseUrl) {
    const urls = getVisibleUrls();
    if (urls.length === 0) {
        showToast('No URLs to export');
        return;
    }
    const blob = new Blob([urls.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'metube_urls.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function copyUrls(baseUrl) {
    const urls = getVisibleUrls();
    if (urls.length === 0) {
        showToast('No URLs to copy');
        return;
    }
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
        showToast('URLs copied to clipboard');
    });
}

async function batchRetry(baseUrl) {
    const failedItems = Array.from(currentDownloads.values()).filter(i => i.status === 'error');
    if (failedItems.length === 0) return;

    setLoading(true);
    try {
        const ids = failedItems.map(i => i.url);
        await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids, where: 'done' })
        });

        for (const item of failedItems) {
            await addDownload(baseUrl, {
                url: item.url,
                quality: item.quality,
                format: item.format,
                folder: item.folder,
                custom_name_prefix: item.custom_name_prefix,
                playlist_item_limit: item.playlist_item_limit || 0,
                split_by_chapters: item.split_by_chapters,
                auto_start: true
            });
        }
        showToast(`Retrying ${failedItems.length} downloads...`);
    } catch (e) {
        console.error(e);
        const msg = e.message === 'Failed to fetch' ? 'Connection failed' : 'Batch retry failed';
        showToast(msg);
    } finally {
        setLoading(false);
    }
}

async function batchClear(baseUrl) {
    const targets = Array.from(currentDownloads.values())
        .filter(i => i.status === 'finished' || i.status === 'error');

    if (targets.length === 0) return;

    const ids = targets.map(i => i.url);
    try {
        await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids, where: 'done' })
        });
        showToast(`Cleared ${targets.length} downloads.`);
    } catch (e) {
        console.error(e);
        const msg = e.message === 'Failed to fetch' ? 'Connection failed' : 'Batch clear failed';
        showToast(msg);
    }
}

function initSocket(baseUrl) {
    if (socket) return;

    const socketUrl = baseUrl.replace(/\/$/, '');
    socket = io(socketUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('Connected');
        const title = document.querySelector('.status-title');
        title.textContent = 'Active Downloads';
        title.classList.remove('error');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected');
        const title = document.querySelector('.status-title');
        title.textContent = 'Disconnected';
        title.classList.add('error');
    });

    socket.on('connect_error', (err) => {
        console.error('Socket Error:', err);
        const title = document.querySelector('.status-title');
        title.textContent = 'Connection Failed';
        title.classList.add('error');
    });

    socket.on('all', (strdata) => {
        const data = JSON.parse(strdata);
        currentDownloads.clear();

        const [active, done] = data;

        if (Array.isArray(active)) {
            active.forEach(([key, item]) => currentDownloads.set(item.url, item));
        }
        if (Array.isArray(done)) {
            done.forEach(([key, item]) => currentDownloads.set(item.url, item));
        }

        renderDownloads(baseUrl);
    });

    socket.on('added', (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        renderDownloads(baseUrl);
    });

    socket.on('updated', (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        updateItemInDom(item, baseUrl);
    });

    socket.on('completed', (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        renderDownloads(baseUrl); // Full render to move item from active to done section if needed
    });

    socket.on('canceled', (strdata) => {
        const url = JSON.parse(strdata);
        currentDownloads.delete(url);
        removeElement(url);
    });

    socket.on('cleared', (strdata) => {
        const url = JSON.parse(strdata);
        currentDownloads.delete(url);
        removeElement(url);
    });
}

function setLoading(isLoading) {
    const btn = document.getElementById('download-btn');
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ?
        `<span>Adding...</span>` :
        `<svg class="icon" viewBox="0 0 24 24"><path d="M19,9h-4V3H9v6H5l7,7L19,9z M5,18v2h14v-2H5z"/></svg> Add To MeTube`;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function renderDownloads(baseUrl) {
    const list = document.getElementById('downloads-list');
    const items = Array.from(currentDownloads.values());

    const hasError = items.some(i => i.status === 'error');
    const hasFinishedOrError = items.some(i => i.status === 'finished' || i.status === 'error');

    document.getElementById('batch-retry-btn').style.display = hasError ? 'block' : 'none';
    document.getElementById('batch-clear-btn').style.display = hasFinishedOrError ? 'block' : 'none';

    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">No active downloads</div>';
        return;
    }

    items.sort((a, b) => {
        const scoreA = getStatusScore(a.status);
        const scoreB = getStatusScore(b.status);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });

    const existingCards = list.querySelectorAll('.download-card');
    const currentUrls = new Set(items.map(i => i.url));
    existingCards.forEach(card => {
        const url = card.dataset.url;
        if (!currentUrls.has(url)) {
            card.remove();
        }
    });

    items.forEach((item, index) => {
        const safeId = getSafeId(item.url);
        let card = document.getElementById(`card-${safeId}`);

        if (card) {
            // Update existing card
            updateItemInDom(item, baseUrl);
        } else {
            // Create new card
            const html = createCardHtml(item);
            const template = document.createElement('div');
            template.innerHTML = html;
            const newCard = template.firstElementChild;

            // Append to list (we'll re-order if necessary, but for now simple append works for new items)
            list.appendChild(newCard);

            // Attach listeners
            const actionBtn = document.getElementById(`action-${safeId}`);
            if (actionBtn) actionBtn.addEventListener('click', () => handleAction(baseUrl, item));
            const retryBtn = document.getElementById(`retry-${safeId}`);
            if (retryBtn) retryBtn.addEventListener('click', () => retryDownload(baseUrl, item));

            const playBtn = document.getElementById(`play-${safeId}`);
            if (playBtn) {
                playBtn.addEventListener('click', () => {
                    const videoUrl = getDownloadUrl(item, baseUrl);
                    const title = item.title || item.filename || 'Video';
                    const width = Math.round(window.screen.availWidth * 0.85);
                    const height = Math.round(window.screen.availHeight * 0.85);
                    const left = Math.round((window.screen.availWidth - width) / 2);
                    const top = Math.round((window.screen.availHeight - height) / 2);

                    chrome.windows.create({
                        url: `player.html?url=${encodeURIComponent(videoUrl)}&title=${encodeURIComponent(title)}`,
                        type: 'popup',
                        width: width,
                        height: height,
                        left: left,
                        top: top
                    });
                });
            }

            const downloadBtn = document.getElementById(`download-${safeId}`);
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    const url = getDownloadUrl(item, baseUrl);
                    if (!url) {
                        showToast('Error: Invalid download URL');
                        return;
                    }
                    chrome.runtime.sendMessage({
                        type: 'DOWNLOAD_FILE',
                        url: url
                    });
                    showToast('Download started...');
                });
            }
        }
    });

    const cardsArray = Array.from(list.querySelectorAll('.download-card'));
    items.forEach((item, index) => {
        const safeId = getSafeId(item.url);
        const card = document.getElementById(`card-${safeId}`);
        if (card && list.children[index] !== card) {
            list.insertBefore(card, list.children[index]);
        }
    });

    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
}

function getSafeId(url) {
    return btoa(url).replace(/[^a-zA-Z0-9]/g, '');
}



function getStatusScore(status) {
    if (status === 'downloading') return 1;
    if (status === 'preparing') return 2;
    if (status === 'pending') return 3;
    if (status === 'error') return 4;
    return 5; // finished
}

function getDownloadUrl(item, baseUrl) {
    // Logic from Metube UI
    let base = baseUrl;
    // Remove potential trailing slash from baseUrl
    base = base.replace(/\/$/, '');

    // Check if it's audio (simplified logic, ideally checks quality/format)
    // For now assuming standard download dir. 
    // If strict audio separation is needed we'd need config.
    // Defaulting to standard download path structure:
    let path = '/download/';

    if (item.folder) {
        path += item.folder + '/';
    }

    return base + path + encodeURIComponent(item.filename);
}

function createCardHtml(item) {
    const safeId = getSafeId(item.url);
    const statusClass = normalizeStatus(item.status);
    const percent = getPercent(item);
    const title = item.title || item.url || 'Unknown Video';
    const isError = item.status === 'error';
    const msg = item.msg || '';

    const isActive = ['pending', 'preparing', 'downloading'].includes(item.status);
    const actionIcon = isActive
        ? `<svg class="icon" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41z"/></svg>` // X
        : `<svg class="icon" viewBox="0 0 24 24"><path d="M6,19c0,1.1,0.9,2,2,2h8c1.1,0,2-0.9,2-2V7H6V19z M19,4h-3.5l-1-1h-5l-1,1H5v2h14V4z"/></svg>`; // Trash

    let retryHtml = '';
    if (isError) {
        retryHtml = `
        <button class="action-btn" id="retry-${safeId}" title="Retry">
            <svg class="icon" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        `;
    }

    const speedText = formatSpeed(item.speed);
    const etaText = formatEta(item.eta);

    return `
        <div class="download-card" id="card-${safeId}" data-url="${item.url}">
            <div class="card-header">
                <div class="file-name" title="${title}">${title}</div>
                <div class="status-badge ${statusClass}" id="badge-${safeId}">${item.status}</div>
            </div>
            <div class="progress-container">
                <div class="progress-bar ${statusClass}" id="bar-${safeId}" style="width: ${percent}%"></div>
            </div>
            <div class="error-message" id="err-${safeId}" style="display: ${isError ? 'block' : 'none'}">${msg}</div>
            <div class="card-footer">
                <div class="meta-info">
                    <span id="speed-${safeId}">${speedText}</span>
                    <span id="eta-${safeId}">${etaText}</span>
                </div>
                <div class="footer-controls" style="display:flex;">
                    <a href="${item.url}" target="_blank" class="action-btn" title="Open Link" style="text-decoration:none; height:auto;">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                    </a>
                    ${item.status === 'finished' ? `
                    <button class="action-btn" id="play-${safeId}" title="Play">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <button class="action-btn" id="download-${safeId}" title="Download">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    </button>
                    ` : ''}
                    ${retryHtml}
                    <button class="action-btn" id="action-${safeId}" title="${isActive ? 'Cancel' : 'Delete'}">
                        ${actionIcon}
                    </button>
                </div>
            </div>
        </div>
    `;
}

function updateItemInDom(item, baseUrl) {
    const safeId = getSafeId(item.url);
    const card = document.getElementById(`card-${safeId}`);
    if (!card) {
        return;
    }

    const normalizedStatus = normalizeStatus(item.status);

    const badge = document.getElementById(`badge-${safeId}`);
    if (badge && badge.textContent !== item.status) {
        badge.textContent = item.status;
        badge.className = `status-badge ${normalizedStatus}`;
    }

    const bar = document.getElementById(`bar-${safeId}`);
    if (bar) {
        const percent = getPercent(item);
        if (bar.style.width !== `${percent}%`) {
            bar.style.width = `${percent}%`;
        }
        if (!bar.classList.contains(normalizedStatus)) {
            bar.className = `progress-bar ${normalizedStatus}`;
        }
    }

    const isError = item.status === 'error';
    const err = document.getElementById(`err-${safeId}`);
    if (err) {
        if (isError && item.msg) {
            if (err.textContent !== item.msg) err.textContent = item.msg;
            err.style.display = 'block';
        } else {
            err.style.display = 'none';
        }
    }

    const speed = document.getElementById(`speed-${safeId}`);
    if (speed) {
        const text = formatSpeed(item.speed);
        if (speed.textContent !== text) speed.textContent = text;
    }

    const eta = document.getElementById(`eta-${safeId}`);
    if (eta) {
        const text = formatEta(item.eta);
        if (eta.textContent !== text) eta.textContent = text;
    }

    const btn = document.getElementById(`action-${safeId}`);
    const isActive = ['pending', 'preparing', 'downloading'].includes(item.status);
    const retryBtn = document.getElementById(`retry-${safeId}`);

    if (btn) {
        const shouldBe = isActive ? 'Cancel' : 'Delete';
        if (btn.getAttribute('title') !== shouldBe || (isError && !retryBtn) || (!isError && retryBtn)) {
            // Surgical replacement of action controls if they changed
            const footerControls = card.querySelector('.footer-controls');
            if (footerControls) {
                const isError = item.status === 'error';
                const isActive = ['pending', 'preparing', 'downloading'].includes(item.status);
                const actionIcon = isActive
                    ? `<svg class="icon" viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41z"/></svg>` // X
                    : `<svg class="icon" viewBox="0 0 24 24"><path d="M6,19c0,1.1,0.9,2,2,2h8c1.1,0,2-0.9,2-2V7H6V19z M19,4h-3.5l-1-1h-5l-1,1H5v2h14V4z"/></svg>`; // Trash

                let retryHtml = '';
                if (isError) {
                    retryHtml = `
                    <button class="action-btn" id="retry-${safeId}" title="Retry">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </button>
                    `;
                }

                footerControls.innerHTML = `
                    <a href="${item.url}" target="_blank" class="action-btn" title="Open Link" style="text-decoration:none; height:auto;">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                    </a>
                    ${item.status === 'finished' ? `
                    <button class="action-btn" id="play-${safeId}" title="Play">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                    <button class="action-btn" id="download-${safeId}" title="Download">
                        <svg class="icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    </button>
                    ` : ''}
                    ${retryHtml}
                    <button class="action-btn" id="action-${safeId}" title="${isActive ? 'Cancel' : 'Delete'}">
                        ${actionIcon}
                    </button>
                `;

                // Re-bind listeners
                const newBtn = document.getElementById(`action-${safeId}`);
                if (newBtn) newBtn.addEventListener('click', () => handleAction(baseUrl, item));
                const newRetry = document.getElementById(`retry-${safeId}`);
                if (newRetry) newRetry.addEventListener('click', () => retryDownload(baseUrl, item));

                const playBtn = document.getElementById(`play-${safeId}`);
                if (playBtn) {
                    playBtn.addEventListener('click', () => {
                        const videoUrl = getDownloadUrl(item, baseUrl);
                        const title = item.title || item.filename || 'Video';
                        const width = Math.round(window.screen.availWidth * 0.85);
                        const height = Math.round(window.screen.availHeight * 0.85);
                        const left = Math.round((window.screen.availWidth - width) / 2);
                        const top = Math.round((window.screen.availHeight - height) / 2);

                        chrome.windows.create({
                            url: `player.html?url=${encodeURIComponent(videoUrl)}&title=${encodeURIComponent(title)}`,
                            type: 'popup',
                            width: width,
                            height: height,
                            left: left,
                            top: top
                        });
                    });
                }

                const downloadBtn = document.getElementById(`download-${safeId}`);
                if (downloadBtn) {
                    downloadBtn.addEventListener('click', () => {
                        const url = getDownloadUrl(item, baseUrl);
                        // console.log('Attempting download:', url, 'Filename:', item.filename);
                        if (!url) {
                            showToast('Error: Invalid download URL');
                            return;
                        }
                        chrome.downloads.download({
                            url: url,
                            // filename: item.filename, // Removed to prevent crashes
                            saveAs: false
                        }, (downloadId) => {
                            if (chrome.runtime.lastError) {
                                console.error('Download failed:', chrome.runtime.lastError);
                                showToast('Download failed: ' + chrome.runtime.lastError.message);
                            } else {
                                // console.log('Download started, ID:', downloadId);
                            }
                        });
                    });
                }
            }
        }
    }
}

function removeElement(url) {
    const safeId = getSafeId(url);
    const card = document.getElementById(`card-${safeId}`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'translateY(10px)';
        setTimeout(() => {
            card.remove();
            checkEmptyState();
        }, 300);
    }
}

function checkEmptyState() {
    const list = document.getElementById('downloads-list');
    if (list.querySelectorAll('.download-card').length === 0) {
        list.innerHTML = '<div class="empty-state">No active downloads</div>';
    }
}

function normalizeStatus(status) {
    // Map API status to CSS class
    if (status === 'downloading') return 'downloading';
    if (status === 'finished') return 'finished';
    if (status === 'error') return 'error';
    if (status === 'preparing') return 'preparing';
    return 'pending';
}

function getPercent(item) {
    if (item.status === 'finished') return 100;
    if (item.percent) {
        if (typeof item.percent === 'string') return parseFloat(item.percent.replace('%', ''));
        return item.percent;
    }
    return 0;
}

function formatSpeed(speed) {
    if (speed === null || speed === undefined || isNaN(speed) || speed <= 0) {
        return '';
    }
    const k = 1024;
    const dm = 2; // decimals
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s', 'EB/s', 'ZB/s', 'YB/s'];
    const i = Math.floor(Math.log(speed) / Math.log(k));
    return parseFloat((speed / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatEta(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (value < 60) {
        return `${Math.round(value)}s`;
    }
    if (value < 3600) {
        return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    }
    const hours = Math.floor(value / 3600);
    const minutes = value % 3600;
    return `${hours}h ${Math.floor(minutes / 60)}m ${Math.round(minutes % 60)}s`;
}

async function addDownload(baseUrl, options) {
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/add`;
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

async function handleAction(baseUrl, item) {
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/delete`;
    const isActive = ['pending', 'preparing', 'downloading'].includes(item.status);
    const where = isActive ? 'queue' : 'done';

    try {
        await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [item.url], where: where })
        });
        // UI update will happen via socket 'canceled' or 'cleared' event
    } catch (e) {
        console.error('Delete failed', e);
        const msg = e.message === 'Failed to fetch' ? 'Connection failed' : 'Action failed';
        showToast(msg);
    }
}

async function retryDownload(baseUrl, item) {
    // Retry means re-adding the download with same options
    // Assuming item contains the original options or we use current defaults? 
    // MeTube's `retryDownload` uses the item's stored options.

    // We first delete the failed item from 'done' (as per MeTube app.ts)
    // Then re-add it.

    try {
        setLoading(true);
        // Delete old one by URL
        await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [item.url], where: 'done' })
        });

        // Add new one
        await addDownload(baseUrl, {
            url: item.url,
            quality: item.quality,
            format: item.format,
            folder: item.folder,
            custom_name_prefix: item.custom_name_prefix,
            playlist_item_limit: item.playlist_item_limit || 0,
            split_by_chapters: item.split_by_chapters,
            auto_start: true
        });

        showToast('Retrying Download...');
    } catch (e) {
        console.error('Retry failed', e);
        const msg = e.message === 'Failed to fetch' ? 'Connection failed' : 'Retry Failed';
        showToast(msg);
    } finally {
        setLoading(false);
    }
}

function setupChangeListeners() {
    const inputs = [
        'quality-select', 'format-select', 'folder-input',
        'prefix-input', 'limit-input', 'chapter-template'
    ];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', checkChanges);
        document.getElementById(id).addEventListener('change', checkChanges);
    });

    const checks = ['autostart-check', 'chapters-check'];
    checks.forEach(id => {
        document.getElementById(id).addEventListener('change', checkChanges);
    });

    // Special handler for format change to update qualities
    document.getElementById('format-select').addEventListener('change', (e) => {
        populateQualities(e.target.value);
        checkChanges();
    });

    document.getElementById('remember-btn').addEventListener('click', saveSettings);
}

function checkChanges() {
    const current = {
        quality: document.getElementById('quality-select').value,
        format: document.getElementById('format-select').value,
        folder: document.getElementById('folder-input').value,
        customNamePrefix: document.getElementById('prefix-input').value,
        playlistItemLimit: document.getElementById('limit-input').value,
        autoStart: document.getElementById('autostart-check').checked,
        splitByChapters: document.getElementById('chapters-check').checked,
        chapterTemplate: document.getElementById('chapter-template').value
    };

    let hasChanges = false;
    for (const key in current) {
        if (current[key] !== savedSettings[key]) {
            hasChanges = true;
            break;
        }
    }

    const toast = document.getElementById('remember-toast');
    if (hasChanges) {
        toast.style.display = 'flex';
        // Small delay to allow display:flex to apply before opacity transition
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });
    } else {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.style.opacity === '0') toast.style.display = 'none';
        }, 300);
    }
}

function saveSettings() {
    const current = {
        quality: document.getElementById('quality-select').value,
        format: document.getElementById('format-select').value,
        folder: document.getElementById('folder-input').value,
        customNamePrefix: document.getElementById('prefix-input').value,
        playlistItemLimit: document.getElementById('limit-input').value,
        autoStart: document.getElementById('autostart-check').checked,
        splitByChapters: document.getElementById('chapters-check').checked,
        chapterTemplate: document.getElementById('chapter-template').value
    };

    chrome.storage.sync.set(current, () => {
        savedSettings = { ...savedSettings, ...current };
        checkChanges(); // Should hide the toast
        showToast('Settings saved as default');
    });
}

function populateFormats(preferredValue) {
    const select = document.getElementById('format-select');
    // If we passed a value, that's what we want. If not, try to keep current value.
    const current = preferredValue || select.value;

    select.innerHTML = '';
    FORMATS.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.text;
        select.appendChild(opt);
    });

    if (current && FORMATS.some(f => f.id === current)) {
        select.value = current;
    } else {
        select.value = 'any';
    }
}

function populateQualities(formatId, preferredQuality) {
    const select = document.getElementById('quality-select');
    const format = FORMATS.find(f => f.id === formatId) || FORMATS[0];
    const current = preferredQuality || select.value;

    select.innerHTML = '';
    format.qualities.forEach(q => {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.text;
        select.appendChild(opt);
    });

    if (current && format.qualities.some(q => q.id === current)) {
        select.value = current;
    } else {
        select.value = 'best';
    }
}
