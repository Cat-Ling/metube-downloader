
importScripts('lib/socket.io.min.js');

const DEFAULT_METUBE_URL = 'http://localhost:8081';
let socket = null;
const pendingContextMenuAdds = new Map(); // url -> { tabId, originalTitle }

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
        console.log('Background connected to MeTube');
    });

    socket.on('completed', (strdata) => {
        chrome.storage.sync.get(['enableNotifications'], (result) => {
            if (result.enableNotifications) {
                const item = JSON.parse(strdata);
                const title = item.title || item.url || 'Download';
                notifyActiveTab('success', 'Download Complete', title);
            }
        });
    });

    socket.on('error', (strdata) => {
        // Only trigger if enabled
        chrome.storage.sync.get(['enableNotifications'], (result) => {
            if (result.enableNotifications) {
                // error event usually comes as string or object, depending on MeTube version
                // But looking at popup.js, it seems we check item.status === 'error' in 'all'/'updated' events
                // However, MeTube emits a specific 'error' event sometimes? 
                // Let's stick to 'completed' and maybe 'updated' if status is error?
                // Actually popup.js doesn't listen to 'error' event on socket, it sees status='error' in item updates.
                // Let's mimic that.
            }
        });
    });

    // MeTube emits 'updated' for progress/status changes. 
    // We should check if status changed to 'error'
    socket.on('updated', (strdata) => {
        chrome.storage.sync.get(['enableNotifications'], (result) => {
            if (result.enableNotifications) {
                const item = JSON.parse(strdata);
                if (item.status === 'error') {
                    const title = item.title || item.url || 'Download';
                    notifyActiveTab('error', 'Download Failed', `${title}: ${item.msg || 'Unknown error'}`);
                }
            }
        });
    });

    socket.on('added', (strdata) => {
        const item = JSON.parse(strdata);
        const pending = pendingContextMenuAdds.get(item.url);
        if (pending) {
            const title = item.title || item.url || 'Download';
            notifyTab(pending.tabId, 'success', `Added: ${title}`, item.url);
            pendingContextMenuAdds.delete(item.url);
        }
    });
}

function notifyActiveTab(status, title, message) {
    notifyTab(null, status, title, message);
}

function notifyTab(tabId, status, title, message) {
    if (!tabId) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                sendNotification(tabs[0].id, status, title, message);
            }
        });
    } else {
        sendNotification(tabId, status, title, message);
    }
}

function sendNotification(tabId, status, title, message) {
    chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_NOTIFICATION',
        status: status,
        title: title,
        message: message
    }, (response) => {
        if (chrome.runtime.lastError) {
            // Ignore error if content script is not ready or not injectable
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
            pendingContextMenuAdds.set(url, { tabId: tabId, originalTitle: pageTitle });

            try {
                const result = await addDownloadToMeTube(metubeUrl, options);

                // If the API response already has a title, we can update the notification immediately
                // However, often link additions don't have titles yet. 
                // The socket listener for 'added' will handle it if we don't have it here.
                if (result && result.title) {
                    notifyTab(tabId, 'success', `Added: ${result.title}`, url);
                    pendingContextMenuAdds.delete(url);
                }
            } catch (error) {
                console.error('Failed to add download via context menu:', error);
                pendingContextMenuAdds.delete(url);
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
