
const DEFAULT_METUBE_URL = 'http://localhost:8081';

function getMetubeUrl() {
    return (savedSettings.metubeUrl || DEFAULT_METUBE_URL).replace(/\/$/, '');
}

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
let currentDownloads = new Map();
let savedSettings = {};
let visibleLimit = 5;
const speedHistory = new Map(); // Store last X samples for smoothing
let totalDownloads = 0;
let searchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    scheduleRender(DEFAULT_METUBE_URL);

    const defaults = {
        metubeUrl: DEFAULT_METUBE_URL,
        quality: 'best',
        format: 'any',
        folder: '',
        customNamePrefix: '',
        playlistItemLimit: '',
        autoStart: true,
        splitByChapters: false,
        chapterTemplate: '',
        cookieUpload: false
    };

    const settings = await chrome.storage.sync.get(Object.keys(defaults));
    savedSettings = { ...defaults, ...settings };

    updateCookieStatus(getMetubeUrl());

    document.getElementById('folder-input').value = savedSettings.folder;
    document.getElementById('prefix-input').value = savedSettings.customNamePrefix;
    document.getElementById('limit-input').value = savedSettings.playlistItemLimit;
    document.getElementById('autostart-check').checked = savedSettings.autoStart;
    document.getElementById('chapters-check').checked = savedSettings.splitByChapters;
    document.getElementById('chapter-template').value = savedSettings.chapterTemplate;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
        document.getElementById('url-input').value = tab.url;
    }

    document.getElementById('chapter-template-container').style.display = savedSettings.splitByChapters ? 'block' : 'none';

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
                chrome.tabs.create({ url: getMetubeUrl() });
            } else {
                const width = Math.round(window.screen.availWidth * 0.85);
                const height = Math.round(window.screen.availHeight * 0.85);
                const left = Math.round((window.screen.availWidth - width) / 2);
                const top = Math.round((window.screen.availHeight - height) / 2);

                chrome.windows.create({
                    url: getMetubeUrl(),
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
    document.getElementById('tool-export').addEventListener('click', () => exportUrls(getMetubeUrl()));
    document.getElementById('tool-copy').addEventListener('click', () => copyUrls(getMetubeUrl()));

    const importModal = document.getElementById('import-modal');
    document.getElementById('import-cancel').addEventListener('click', () => {
        importModal.style.display = 'none';
        document.getElementById('import-text').value = '';
    });
    document.getElementById('import-confirm').addEventListener('click', () => startBatchImport(getMetubeUrl()));

    function openImportModal() {
        importModal.style.display = 'flex';
        document.getElementById('import-text').focus();
    }

    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', async () => {
        const url = document.getElementById('url-input').value;
        if (!url) return;

        // Adding hides search
        toggleSearch(false);

        const quality = document.getElementById('quality-select').value;
        const format = document.getElementById('format-select').value;
        const folder = document.getElementById('folder-input').value;
        const prefix = document.getElementById('prefix-input').value;
        const limit = document.getElementById('limit-input').value;
        const autoStart = document.getElementById('autostart-check').checked;
        const splitChapters = document.getElementById('chapters-check').checked;
        const chapterTemplate = document.getElementById('chapter-template').value;

        if (splitChapters && !chapterTemplate.includes('%(section_number)')) {
            showToast('Chapter template must include %(section_number)', 'error');
            return;
        }

        setLoading(true);
        try {
            const task = {
                baseUrl: getMetubeUrl(),
                options: {
                    url: url,
                    quality: quality,
                    format: format,
                    codec: 'auto',
                    folder: folder,
                    custom_name_prefix: prefix,
                    playlist_item_limit: limit ? parseInt(limit) : 0,
                    auto_start: autoStart,
                    split_by_chapters: splitChapters,
                    chapter_template: chapterTemplate
                },
                cookieUpload: false, // Now manual via dedicated buttons
                tabId: tab ? tab.id : null,
                title: '' 
            };

            await chrome.runtime.sendMessage({ type: 'QUEUE_DOWNLOAD', task: task });
            showToast('Added to Queue');
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

    batchRetryBtn.addEventListener('click', () => batchRetry(getMetubeUrl()));
    batchClearBtn.addEventListener('click', () => {
        document.getElementById('clear-modal').style.display = 'flex';
        toggleSearch(false);
    });

    document.getElementById('clear-cancel').addEventListener('click', () => {
        document.getElementById('clear-modal').style.display = 'none';
    });

    document.getElementById('clear-failed-btn').addEventListener('click', () => {
        batchClear(getMetubeUrl(), 'error');
        document.getElementById('clear-modal').style.display = 'none';
    });

    document.getElementById('clear-completed-btn').addEventListener('click', () => {
        batchClear(getMetubeUrl(), 'finished');
        document.getElementById('clear-modal').style.display = 'none';
    });

    document.getElementById('clear-all-btn').addEventListener('click', () => {
        batchClear(getMetubeUrl(), 'all');
        document.getElementById('clear-modal').style.display = 'none';
    });

    // Search & Pagination Listeners
    document.getElementById('search-toggle-btn').addEventListener('click', () => {
        const container = document.getElementById('search-container');
        const isHidden = container.style.maxHeight === '0px' || !container.style.maxHeight;
        toggleSearch(isHidden);
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        // Reset pagination on search
        visibleLimit = searchQuery ? 1000 : 5;
        // If searching, we might need all data?
        // Ideally search should be server-side too but for now let's just fetch more if needed
        // or just filter what we have. 
        // With limited data in popup, local search only searches visible items.
        // To fix this proper search requires backend support or fetching all IDs.
        // For now, let's keep it simple: search searches loaded items.
        // Or improved: if search is active, fetch all (or large chunk)
        if (searchQuery) {
            visibleLimit = 100; // fetch more for search
            getState();
        } else {
            visibleLimit = 5;
            getState();
        }
    });

    document.getElementById('show-more-btn').addEventListener('click', () => {
        visibleLimit += 10;
        getState();
    });

    // Initial state fetch
    getState();

    // Cookie Management Listeners
    document.getElementById('upload-site-cookies-btn').addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
            showToast('No active tab found');
            return;
        }
        
        showToast('Extracting & uploading site cookies...');
        chrome.runtime.sendMessage({ 
            type: 'UPLOAD_SITE_COOKIES', 
            url: tab.url, 
            baseUrl: getMetubeUrl() 
        }, (result) => {
            if (result && result.success) {
                showToast('Site cookies uploaded successfully', 'success');
                updateCookieStatus(getMetubeUrl());
            } else {
                showToast('Failed: ' + (result ? result.msg : 'Unknown error'), 'error');
            }
        });
    });
    const cookieFileInput = document.getElementById('cookie-file-input');

    cookieFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showToast('Uploading local cookie file...');
        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target.result;
            chrome.runtime.sendMessage({ 
                type: 'UPLOAD_RAW_COOKIES', 
                text: text, 
                baseUrl: getMetubeUrl() 
            }, (result) => {
                if (result && result.success) {
                    showToast('Cookie file uploaded', 'success');
                    updateCookieStatus(getMetubeUrl());
                } else {
                    showToast('Upload failed: ' + (result ? result.msg : 'Unknown error'), 'error');
                }
                cookieFileInput.value = ''; // Reset
            });
        };
        reader.readAsText(file);
    });

    document.getElementById('delete-cookies-btn').addEventListener('click', () => {
        document.getElementById('cookie-confirm-modal').style.display = 'flex';
    });

    document.getElementById('cookie-confirm-cancel').addEventListener('click', () => {
        document.getElementById('cookie-confirm-modal').style.display = 'none';
    });

    document.getElementById('cookie-confirm-delete-btn').addEventListener('click', () => {
        document.getElementById('cookie-confirm-modal').style.display = 'none';
        setLoading(true);
        chrome.runtime.sendMessage({ 
            type: 'DELETE_COOKIES', 
            baseUrl: getMetubeUrl() 
        }, (result) => {
            setLoading(false);
            if (result && result.success) {
                showToast('Cookies deleted from server', 'success');
                updateCookieStatus(getMetubeUrl());
            } else {
                showToast('Delete failed: ' + (result ? result.msg : 'Unknown error'), 'error');
            }
        });
    });

    // Listen for updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'SOCKET_EVENT') {
            const { eventType, data } = message;
            handleSocketEvent(eventType, data, getMetubeUrl());
        }
    });

    // Refresh cookie status periodically while popup is open
    const statusInterval = setInterval(() => updateCookieStatus(getMetubeUrl()), 5000);
    window.addEventListener('unload', () => clearInterval(statusInterval));
});

function updateCookieStatus(baseUrl) {
    chrome.runtime.sendMessage({ type: 'GET_COOKIE_STATUS', baseUrl: baseUrl }, (response) => {
        const icon = document.getElementById('cookie-status-icon');
        const statusText = document.getElementById('cookie-status-text');
        const delBtn = document.getElementById('delete-cookies-btn');
        const siteBtnText = document.getElementById('upload-site-cookies-text');
        const fileBtnText = document.getElementById('upload-cookie-file-text');

        if (response && response.success) {
            if (response.has_cookies) {
                icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24" style="fill: var(--success);"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
                statusText.textContent = 'Cookies active on server';
                statusText.style.color = 'var(--success)';
                delBtn.style.display = 'block';
                
                if (siteBtnText) siteBtnText.textContent = 'Replace Site';
                if (fileBtnText) fileBtnText.textContent = 'Replace File';
            } else {
                icon.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';
                statusText.textContent = 'No cookies configured';
                statusText.style.color = 'var(--text-muted)';
                delBtn.style.display = 'none';

                if (siteBtnText) siteBtnText.textContent = 'Site Cookies';
                if (fileBtnText) fileBtnText.textContent = 'Local File';
            }
        }
    });
}



function toggleSearch(show) {
    const container = document.getElementById('search-container');
    const input = document.getElementById('search-input');
    if (show) {
        container.style.maxHeight = '50px';
        container.style.marginBottom = '12px';
        input.focus();
    } else {
        container.style.maxHeight = '0px';
        container.style.marginBottom = '0px';
        input.value = '';
        searchQuery = '';
        visibleLimit = 5;
        getState(); // Refresh with default limit
    }
}

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
        const task = {
            baseUrl: baseUrl,
            options: {
                url: url,
                quality: quality,
                format: format,
                codec: 'auto',
                folder: folder,
                custom_name_prefix: prefix,
                playlist_item_limit: limit ? parseInt(limit) : 0,
                auto_start: autoStart,
                split_by_chapters: splitChapters,
                chapter_template: chapterTemplate
            },
            cookieUpload: false, // Batch import usually doesn't need per-tab cookies? 
            // Or maybe it should use current tab cookies for all? 
            // For now false to avoid confusion.
            tabId: null
        };
        await chrome.runtime.sendMessage({ type: 'QUEUE_DOWNLOAD', task: task });
    }
    showToast('Batch import queued');
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
    chrome.runtime.sendMessage({ type: 'GET_STATE', limit: 999 }, async (response) => {
        if (!response || !response.downloads) return;
        
        const failedItems = response.downloads.map(d => d[1]).filter(i => i.status === 'error');
        if (failedItems.length === 0) {
            showToast('No failed items to retry');
            return;
        }

        setLoading(true);
        try {
            const ids = failedItems.map(i => i.url);
            // Clear from server's failed list
            await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids, where: 'done' })
            });

            // Re-enqueue all failed tasks
            for (const item of failedItems) {
                const task = {
                    baseUrl: baseUrl,
                    options: {
                        url: item.url,
                        quality: item.quality,
                        format: item.format,
                        codec: 'auto',
                        folder: item.folder,
                        custom_name_prefix: item.custom_name_prefix,
                        playlist_item_limit: item.playlist_item_limit || 0,
                        split_by_chapters: item.split_by_chapters,
                        auto_start: true
                    },
                    cookieUpload: false,
                    tabId: null
                };
                chrome.runtime.sendMessage({ type: 'QUEUE_DOWNLOAD', task: task });
            }
            showToast(`Retrying ${failedItems.length} downloads...`, 'info');
        } catch (e) {
            console.error('Batch retry failed', e);
            showToast('Batch retry failed', 'error');
        } finally {
            setLoading(false);
        }
    });
}

async function batchClear(baseUrl, typeFilter = 'all') {
    // We must fetch ALL items from background first, 
    // because currentDownloads is paginated/limited.
    chrome.runtime.sendMessage({ type: 'GET_STATE', limit: 999 }, async (response) => {
        if (!response || !response.downloads) return;
        
        const allItems = response.downloads.map(d => d[1]);
        let targets = [];
        
        if (typeFilter === 'error') {
            targets = allItems.filter(i => i.status === 'error');
        } else if (typeFilter === 'finished') {
            targets = allItems.filter(i => i.status === 'finished');
        } else {
            // all completed/failed
            targets = allItems.filter(i => i.status === 'finished' || i.status === 'error');
        }

        if (targets.length === 0) {
            let msg = 'Nothing to clear';
            if (typeFilter === 'error') msg = 'No failed downloads to clear';
            else if (typeFilter === 'finished') msg = 'No completed downloads to clear';
            showToast(msg, 'info');
            return;
        }

        const ids = targets.map(i => i.url);
        try {
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids, where: 'done' })
            });
            if (res.ok) {
                let successMsg = `Cleared ${targets.length} downloads`;
                if (typeFilter === 'error') successMsg = `Cleared ${targets.length} failed downloads`;
                else if (typeFilter === 'finished') successMsg = `Cleared ${targets.length} completed downloads`;
                
                showToast(successMsg, 'success');
                // State will auto-update via socket, but we can refresh manually too
                getState();
            } else {
                showToast('Server error during clear', 'error');
            }
        } catch (e) {
            console.error('Batch clear failed', e);
            showToast('Connection failed during clear', 'error');
        }
    });
}

function getState() {
    chrome.runtime.sendMessage({ type: 'GET_STATE', limit: visibleLimit }, (response) => {
        if (response && response.downloads) {
            // Merge or Replace? 
            // Replacing is safer to ensure sync with pagination.
            // currentDownloads acts as "Visible Downloads" now.
            currentDownloads = new Map(response.downloads);
            totalDownloads = response.total || currentDownloads.size;

            scheduleRender(getMetubeUrl());

            const title = document.querySelector('.status-title');
            if (response.connected) {
                title.textContent = 'Active Downloads';
                title.classList.remove('error');
            } else {
                title.textContent = 'Disconnected';
                title.classList.add('error');
            }
        }
    });
}

function handleSocketEvent(eventType, strdata, baseUrl) {
    // console.log('Popup received event:', eventType);

    if (eventType === 'connect') {
        const title = document.querySelector('.status-title');
        title.textContent = 'Active Downloads';
        title.classList.remove('error');
        return;
    }

    if (eventType === 'disconnect' || eventType === 'connect_error') {
        const title = document.querySelector('.status-title');
        title.textContent = eventType === 'disconnect' ? 'Disconnected' : 'Connection Failed';
        title.classList.add('error');
        return;
    }

    // Data events
    if (['all', 'added', 'updated', 'completed', 'canceled', 'cleared'].includes(eventType)) {
        if (eventType === 'all') {
            // 'all' event is huge, we should probably ignore it and fetch via getState?
            // Or if we must handle it:
            // Since 'all' sends everything, parsing it is expensive.
            // Better to re-fetch state with current limit.
            getState();
            return;
        } else if (eventType === 'added') {
            // New item should be visible immediately
            const item = JSON.parse(strdata);
            currentDownloads.set(item.url, item);
            totalDownloads++;
            // If we are strictly paginating, we might have > visibleLimit items now.
            // renderDownloads handles the slicing so it's fine.
        } else if (eventType === 'canceled' || eventType === 'cleared') {
            const url = JSON.parse(strdata);
            currentDownloads.delete(url);
            // scheduleRender handles the DOM, but removeElement was used in old code for individual removal.
            // keeping it simple with scheduleRender is better for consistency, 
            // but if we want instant removal we can do it here too.
            // For now, scheduleRender is sufficient and cleaner.
        } else {
            // updated, completed
            const item = JSON.parse(strdata);
            // Only update if we already have it (it's visible)
            if (currentDownloads.has(item.url)) {
                currentDownloads.set(item.url, item);
            }
            // If it's completed, it might move down or change status, fine.
        }

        scheduleRender(baseUrl);
    }
}

function setLoading(isLoading) {
    const btn = document.getElementById('download-btn');
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ?
        `<span>Adding...</span>` :
        `<svg class="icon" viewBox="0 0 24 24"><path d="M19,9h-4V3H9v6H5l7,7L19,9z M5,18v2h14v-2H5z"/></svg> Add To MeTube`;
}

async function showToast(message, type = 'info') {
    const settings = await chrome.storage.sync.get(['enableNotifications']);
    if (settings.enableNotifications === false) return;

    const toast = document.getElementById('toast');
    toast.textContent = message;
    
    // Reset classes and add new ones
    toast.className = 'toast show ' + type;
    
    setTimeout(() => toast.classList.remove('show'), 3000);
}

let renderScheduled = false;

function scheduleRender(baseUrl) {
    if (!renderScheduled) {
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderDownloads(baseUrl);
            renderScheduled = false;
        });
    }
}

function renderDownloads(baseUrl) {
    const list = document.getElementById('downloads-list');
    const showMoreBtn = document.getElementById('show-more-btn');

    // Convert map to array
    let items = Array.from(currentDownloads.values());

    // Filter by search query
    if (searchQuery) {
        items = items.filter(item => {
            const title = (item.title || item.url || '').toLowerCase();
            return title.includes(searchQuery);
        });
    }

    const hasError = items.some(i => i.status === 'error');
    const hasFinishedOrError = items.some(i => i.status === 'finished' || i.status === 'error');

    const retryBtn = document.getElementById('batch-retry-btn');
    const clearBtn = document.getElementById('batch-clear-btn');

    if (retryBtn.style.display !== (hasError ? 'block' : 'none')) {
        retryBtn.style.display = hasError ? 'block' : 'none';
    }
    if (clearBtn.style.display !== (hasFinishedOrError ? 'block' : 'none')) {
        clearBtn.style.display = hasFinishedOrError ? 'block' : 'none';
    }

    if (items.length === 0) {
        if (!list.querySelector('.empty-state')) {
            list.innerHTML = '<div class="empty-state">No active downloads</div>';
        }
        showMoreBtn.style.display = 'none';
        return;
    }

    // Sort: purely date descending (latest first)
    items.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        return timeB - timeA;
    });

    const totalItems = items.length;
    const visibleItems = items.slice(0, visibleLimit);

    // Show/Hide "Show More"
    // totalItems is just what we have locally.
    // We should use totalDownloads from server.
    const hasMore = totalDownloads > currentDownloads.size;

    if (hasMore) {
        if (showMoreBtn.style.display !== 'block') showMoreBtn.style.display = 'block';
        const remaining = totalDownloads - currentDownloads.size;
        showMoreBtn.textContent = `Show More (${remaining})`;
    } else {
        if (showMoreBtn.style.display !== 'none') showMoreBtn.style.display = 'none';
    }

    // DOM Diffing / Updating
    const existingCards = list.querySelectorAll('.download-card');
    const visibleUrls = new Set(visibleItems.map(i => i.url));
    const visibleSafeIds = new Set(visibleItems.map(i => getSafeId(i.url)));

    // Remove invisible cards
    existingCards.forEach(card => {
        const url = card.dataset.url;
        if (!visibleUrls.has(url)) {
            card.remove();
        }
    });

    // Remove empty state if present
    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Render visible
    visibleItems.forEach((item, index) => {
        const safeId = getSafeId(item.url);
        let card = document.getElementById(`card-${safeId}`);

        if (card) {
            updateItemInDom(item, baseUrl);
        } else {
            const html = createCardHtml(item);
            const template = document.createElement('div');
            template.innerHTML = html;
            const newCard = template.firstElementChild;
            list.appendChild(newCard);
            attachCardListeners(newCard, safeId, item, baseUrl);
            card = newCard;
        }

        // Reorder if necessary
        // Optimization: checking children[index] is faster than blindly inserting
        const currentChildAtIndex = list.children[index];
        if (currentChildAtIndex !== card) {
            if (currentChildAtIndex) {
                list.insertBefore(card, currentChildAtIndex);
            } else {
                list.appendChild(card);
            }
        }
    });
}

function attachCardListeners(card, safeId, item, baseUrl) {
    const actionBtn = document.getElementById(`action-${safeId}`);
    if (actionBtn) actionBtn.addEventListener('click', () => {
        const latest = currentDownloads.get(item.url) || item;
        handleAction(baseUrl, latest);
    });

    const retryBtn = document.getElementById(`retry-${safeId}`);
    if (retryBtn) retryBtn.addEventListener('click', () => {
        const latest = currentDownloads.get(item.url) || item;
        retryDownload(baseUrl, latest);
    });

    const playBtn = document.getElementById(`play-${safeId}`);
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            const latest = currentDownloads.get(item.url) || item;
            const videoUrl = getDownloadUrl(latest, baseUrl);
            const title = latest.title || latest.filename || 'Media';
            const isAudio = isAudioType(latest);
            
            const width = isAudio ? 400 : Math.round(window.screen.availWidth * 0.85);
            const height = isAudio ? 500 : Math.round(window.screen.availHeight * 0.85);
            const left = Math.round((window.screen.availWidth - width) / 2);
            const top = Math.round((window.screen.availHeight - height) / 2);

            const b64Url = btoa(unescape(encodeURIComponent(videoUrl)));
            const b64Title = btoa(unescape(encodeURIComponent(title)));
            const b64Type = btoa(unescape(encodeURIComponent(latest.download_type || (isAudio ? 'audio' : 'video'))));
            
            const thumbnail = latest.thumbnail || (latest.entry && latest.entry.thumbnail) || '';
            const b64Poster = thumbnail ? btoa(unescape(encodeURIComponent(thumbnail))) : '';

            chrome.windows.create({
                url: `player.html?b64_url=${encodeURIComponent(b64Url)}&b64_title=${encodeURIComponent(b64Title)}&b64_type=${encodeURIComponent(b64Type)}${b64Poster ? '&b64_poster=' + encodeURIComponent(b64Poster) : ''}`,
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
            const latest = currentDownloads.get(item.url) || item;
            const url = getDownloadUrl(latest, baseUrl);
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

function getFooterHtml(item, safeId) {
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
        </button>`;
    }

    return `
        <a href="${item.url}" target="_blank" class="action-btn" title="Open Link" style="text-decoration:none; height:auto;">
            <svg class="icon" viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </a>
        ${(item.status === 'finished' && item.filename) ? `
        <button class="action-btn" id="play-${safeId}" title="Play">
            <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="action-btn" id="download-${safeId}" title="Download">
            <svg class="icon" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>` : ''}
        ${retryHtml}
        <button class="action-btn" id="action-${safeId}" title="${isActive ? 'Cancel' : 'Delete'}">
            ${actionIcon}
        </button>`;
}

function createCardHtml(item) {
    const safeId = getSafeId(item.url);
    const statusClass = normalizeStatus(item.status);
    const percent = getPercent(item);
    const title = item.title || item.url || 'Unknown Video';
    const isError = item.status === 'error';
    const msg = item.msg || '';

    const speedText = formatSpeed(item.speed, item.url);
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
                    ${getFooterHtml(item, safeId)}
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
        const text = formatSpeed(item.speed, item.url);
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
                footerControls.innerHTML = getFooterHtml(item, safeId);
                attachCardListeners(card, safeId, item, baseUrl);
            }
        }
    }
}

function isAudioType(item) {
    return item.download_type === 'audio' || item.format === 'mp3' || item.format === 'm4a' || item.format === 'opus';
}

function getDownloadUrl(item, baseUrl) {
    if (!item || !item.filename) return '';

    let base = baseUrl.replace(/\/$/, '');
    const path = isAudioType(item) ? '/audio_download/' : '/download/';

    let fullPath = path;
    if (item.folder) {
        fullPath += item.folder + '/';
    }

    return base + fullPath + encodeURIComponent(item.filename);
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

function formatSpeed(speed, url) {
    if (speed === null || speed === undefined || isNaN(speed) || speed <= 0) {
        if (url) speedHistory.delete(url);
        return '';
    }

    let displaySpeed = speed;
    if (url) {
        let history = speedHistory.get(url) || [];
        history.push(speed);
        if (history.length > 8) history.shift(); // Smooth last 8 samples (~8 seconds of history)
        speedHistory.set(url, history);
        displaySpeed = history.reduce((a, b) => a + b, 0) / history.length;
    }

    const k = 1024;
    const dm = 2; // decimals
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(displaySpeed) / Math.log(k));
    return parseFloat((displaySpeed / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
function handleAction(baseUrl, item) {
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/delete`;
    const isActive = ['pending', 'preparing', 'downloading'].includes(item.status);
    const where = isActive ? 'queue' : 'done';

    try {
        fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [item.url], where: where })
        });
    } catch (e) {
        console.error('Delete failed', e);
    }
}

async function retryDownload(baseUrl, item) {
    try {
        setLoading(true);
        // Delete old one
        await fetch(`${baseUrl.replace(/\/$/, '')}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [item.url], where: 'done' })
        });

        // Add new one via background queue
        const task = {
            baseUrl: baseUrl,
            options: {
                url: item.url,
                quality: item.quality,
                format: item.format,
                codec: 'auto',
                folder: item.folder,
                custom_name_prefix: item.custom_name_prefix,
                playlist_item_limit: item.playlist_item_limit || 0,
                split_by_chapters: item.split_by_chapters,
                auto_start: true
            },
            cookieUpload: false,
            tabId: null
        };
        await chrome.runtime.sendMessage({ type: 'QUEUE_DOWNLOAD', task: task });
        showToast('Retrying Download...');
    } catch (e) {
        console.error('Retry failed', e);
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
        checkChanges();
        showToast('Settings saved as default');
    });
}

function populateFormats(preferredValue) {
    const select = document.getElementById('format-select');
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
