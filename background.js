importScripts('lib/socket.io.min.js');

const DEFAULT_METUBE_URL = 'http://localhost:8081';
let socket = null;

// URL Normalization for better matching
function normalizeUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        // Remove trailing slash and fragments/hashes
        // Also strip 'www.' for better matching
        let host = u.hostname.replace(/^www\./i, '');

        let searchParams = new URLSearchParams(u.search);
        // Stripping common "junk" parameters that often cause mismatches on YouTube
        const junk = ['t', 'pp', 'si', 'feature', 'index', 'list', 'playnext', 'attr_tag'];
        junk.forEach(p => searchParams.delete(p));

        const cleanSearch = searchParams.toString();
        let normalized = (u.protocol + '//' + host + u.pathname + (cleanSearch ? '?' + cleanSearch : '')).replace(/\/$/, '');
        return normalized;
    } catch (e) {
        return url.replace(/\/$/, '');
    }
}

// Persistent state management
async function addPendingAdd(url, data) {
    const normalizedUrl = normalizeUrl(url);
    const result = await chrome.storage.session.get('pendingAdds');
    const pendingAdds = result.pendingAdds || {};
    pendingAdds[normalizedUrl] = data;
    console.log('[MeTube] Storing pending add:', normalizedUrl, data);
    await chrome.storage.session.set({ pendingAdds });
}

async function getPopPendingAdd(url) {
    const normalizedUrl = normalizeUrl(url);
    const result = await chrome.storage.session.get('pendingAdds');
    const pendingAdds = result.pendingAdds || {};
    const data = pendingAdds[normalizedUrl];

    console.log('[MeTube] Looking up pending add:', normalizedUrl, 'Found:', data ? 'YES' : 'NO');

    if (data) {
        delete pendingAdds[normalizedUrl];
        await chrome.storage.session.set({ pendingAdds });
    }
    return data;
}

async function clearPendingAdd(url) {
    const normalizedUrl = normalizeUrl(url);
    const result = await chrome.storage.session.get('pendingAdds');
    const pendingAdds = result.pendingAdds || {};
    if (pendingAdds[normalizedUrl]) {
        console.log('[MeTube] Clearing pending add:', normalizedUrl);
        delete pendingAdds[normalizedUrl];
        await chrome.storage.session.set({ pendingAdds });
    }
}

// Initialize socket connection
function initSocket(url) {
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    const socketUrl = url.replace(/\/$/, '');
    socket = io(socketUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('[MeTube] Background connected');
    });

    socket.on('completed', (strdata) => {
        const item = JSON.parse(strdata);
        console.log('[MeTube] Download completed:', item.title || item.url);
        const title = item.title || item.url || 'Download';
        notifyActiveTab('success', 'Download Complete', title);
    });

    socket.on('error', (strdata) => {
        console.error('[MeTube] Socket error event:', strdata);
    });

    socket.on('updated', (strdata) => {
        const item = JSON.parse(strdata);
        if (item.status === 'error') {
            console.error('[MeTube] Download failed:', item.title || item.url, item.msg);
            const title = item.title || item.url || 'Download';
            notifyActiveTab('error', 'Download Failed', `${title}: ${item.msg || 'Unknown error'}`);
        }
    });

    socket.on('added', async (strdata) => {
        const item = JSON.parse(strdata);
        const urlToMatch = item.original_url || item.url;
        console.log('[MeTube] Item added event:', urlToMatch);

        const pending = await getPopPendingAdd(urlToMatch);

        if (pending) {
            console.log('[MeTube] Found pending add for:', urlToMatch, 'notifying tab:', pending.tabId);
            const title = item.title || item.url || 'Download';
            notifyTab(pending.tabId, 'success', `Added: ${title}`, item.url);
        } else {
            console.log('[MeTube] No pending add found for:', urlToMatch, '- possibly added via popup.');
        }
    });
}

function notifyActiveTab(status, title, message) {
    notifyTab(null, status, title, message);
}

function notifyTab(tabId, status, title, message) {
    chrome.storage.sync.get(['enableNotifications'], (result) => {
        const enabled = result.enableNotifications !== false; // Default to true if not set, or follow user
        if (!enabled) {
            console.log('[MeTube] Notifications disabled by user setting');
            return;
        }

        if (!tabId) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) {
                    console.log('[MeTube] Notifying active tab:', tabs[0].id, title);
                    sendNotification(tabs[0].id, status, title, message);
                }
            });
        } else {
            console.log('[MeTube] Notifying specific tab:', tabId, title);
            sendNotification(tabId, status, title, message);
        }
    });
}

function sendNotification(tabId, status, title, message) {
    chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_NOTIFICATION',
        status: status,
        title: title,
        message: message
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn('[MeTube] Could not send notification to tab (script not ready?):', chrome.runtime.lastError.message);
        }
    });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(['metubeUrl', 'enableNotifications'], (result) => {
        if (!result.metubeUrl) {
            chrome.storage.sync.set({ metubeUrl: DEFAULT_METUBE_URL });
            initSocket(DEFAULT_METUBE_URL);
        } else {
            initSocket(result.metubeUrl);
        }

        if (result.enableNotifications === undefined) {
            chrome.storage.sync.set({ enableNotifications: false });
        }
    });

    // Create context menu items
    chrome.contextMenus.create({
        id: 'add-page-to-metube',
        title: 'Add To MeTube',
        contexts: ['page']
    });

    chrome.contextMenus.create({
        id: 'add-link-to-metube',
        title: 'Add Link To MeTube',
        contexts: ['link']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    let url = '';
    let pageTitle = tab ? tab.title : '';
    const tabId = tab ? tab.id : null;

    if (info.menuItemId === 'add-page-to-metube') {
        url = info.pageUrl;
    } else if (info.menuItemId === 'add-link-to-metube') {
        url = info.linkUrl;
    }

    if (url) {
        chrome.storage.sync.get([
            'metubeUrl', 'quality', 'format', 'folder',
            'autoStart', 'customNamePrefix', 'playlistItemLimit',
            'splitByChapters', 'chapterTemplate'
        ], async (settings) => {
            const metubeUrl = settings.metubeUrl || DEFAULT_METUBE_URL;
            const options = {
                url: url,
                quality: settings.quality || 'best',
                format: settings.format || 'any',
                folder: settings.folder || '',
                auto_start: settings.autoStart !== undefined ? settings.autoStart : true,
                custom_name_prefix: settings.customNamePrefix || '',
                playlist_item_limit: settings.playlistItemLimit ? parseInt(settings.playlistItemLimit) : 0,
                split_by_chapters: settings.splitByChapters || false,
                chapter_template: settings.chapterTemplate || ''
            };

            // Immediate "Adding" notification
            const addingTitle = (info.menuItemId === 'add-page-to-metube' && pageTitle) ? `Adding: ${pageTitle}` : 'Adding to MeTube';
            notifyTab(tabId, 'info', addingTitle, url);

            // Track this add to show title in success notification later via socket
            await addPendingAdd(url, { tabId: tabId, originalTitle: pageTitle });

            try {
                const result = await addDownloadToMeTube(metubeUrl, options);

                // If the API response already has a title, we can update the notification immediately
                if (result && result.title) {
                    notifyTab(tabId, 'success', `Added: ${result.title}`, url);
                    await clearPendingAdd(url);
                }
            } catch (error) {
                console.error('Failed to add download via context menu:', error);
                await clearPendingAdd(url);
                notifyTab(tabId, 'error', 'Failed to add to MeTube', `${error.message}\n${url}`);
            }
        });
    }
});

async function addDownloadToMeTube(baseUrl, options) {
    const apiUrl = `${baseUrl.replace(/\/$/, '')}/add`;
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

// Re-init socket if settings change
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.metubeUrl) {
        initSocket(changes.metubeUrl.newValue);
    }
});

// Initialize on startup
chrome.storage.sync.get(['metubeUrl'], (result) => {
    if (result.metubeUrl) {
        initSocket(result.metubeUrl);
    }
});

// Keep-alive for Firefox MV3
// Firefox unloads the background script after 30 seconds of inactivity.
// We use an alarm to wake it up periodically.
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 }); // 30 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        // Just checking storage or pinging something triggers activity
        chrome.storage.sync.get(['metubeUrl'], (result) => {
            if (socket && socket.connected) {
                // console.log('Background is alive, socket connected');
                // Optional: send a ping if MeTube expects one, 
                // but usually the socket.io heartbeat handles it if the script is running.
            } else {
                // console.log('Background woke up, socket disconnected. Reconnecting...');
                if (result.metubeUrl) {
                    initSocket(result.metubeUrl);
                }
            }
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_FILE') {
        chrome.downloads.download({
            url: message.url,
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('Background download failed:', chrome.runtime.lastError);
            }
        });
    }
});
