// Shim for socket.io offline listener which is not allowed in MV3 Service Workers asynchronously
// This MUST be before any library imports.
const originalAddEventListener = self.addEventListener.bind(self);
self.addEventListener = (type, listener, options) => {
    if (type === 'offline' || type === 'online') {
        console.log(`[MeTube] Swallowing ${type} listener for MV3 compatibility`);
        return;
    }
    return originalAddEventListener(type, listener, options);
};

importScripts('lib/socket.io.min.js');

const DEFAULT_METUBE_URL = 'http://localhost:8081';
let socket = null;
let currentDownloads = new Map();
let downloadQueue = [];
let isProcessingQueue = false;
let cookieStore = {}; // domain -> cookie object array

function broadcastEvent(type, data) {
    chrome.runtime.sendMessage({
        type: 'SOCKET_EVENT',
        eventType: type,
        data: data
    }).catch(err => {
        // Popeup closed, ignore
    });
}

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

    const socketUrl = url;
    console.log('[MeTube] Initializing socket at:', socketUrl);
    
    socket = io(socketUrl, {
        transports: ['websocket'],
        reconnectionDelay: 2000, 
        reconnectionDelayMax: 10000,
        autoConnect: true
    });

    socket.on('connect_error', (err) => {
        // Just a warning to avoid the red error text in console if server is simply off
        if (!socket._notifiedError) {
            console.warn('[MeTube] Server unreachable at', socketUrl, ' - checking again in 5s...');
        }
        
        broadcastEvent('connect_error', { message: err.message });
        
        // Only notify user once per failure session
        if (!socket._notifiedError) {
            notifyActiveTab('warning', 'MeTube Offline', `Cannot reach MeTube at ${socketUrl}. Make sure your server is running or update the URL in settings.`);
            socket._notifiedError = true;
        }
    });

    socket.on('connect', () => {
        console.log('[MeTube] Background connected');
        socket._notifiedError = false;
        broadcastEvent('connect');
    });

    socket.on('all', (strdata) => {
        const data = JSON.parse(strdata);
        currentDownloads.clear();
        const [active, done] = data;
        if (Array.isArray(active)) active.forEach(([key, item]) => currentDownloads.set(item.url, item));
        if (Array.isArray(done)) done.forEach(([key, item]) => currentDownloads.set(item.url, item));
        broadcastEvent('all', strdata);
    });

    socket.on('added', async (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        broadcastEvent('added', strdata);

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

    socket.on('updated', (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        broadcastEvent('updated', strdata);

        if (item.status === 'error') {
            console.error('[MeTube] Download failed:', item.title || item.url, item.msg);
            const title = item.title || item.url || 'Download';
            notifyActiveTab('error', 'Download Failed', `${title}: ${item.msg || 'Unknown error'}`);
        }
    });

    socket.on('completed', (strdata) => {
        const item = JSON.parse(strdata);
        currentDownloads.set(item.url, item);
        broadcastEvent('completed', strdata);

        console.log('[MeTube] Download completed:', item.title || item.url);
        const title = item.title || item.url || 'Download';
        notifyActiveTab('success', 'Download Complete', title);
    });

    socket.on('canceled', (strdata) => {
        const url = JSON.parse(strdata);
        currentDownloads.delete(url);
        broadcastEvent('canceled', strdata);
    });

    socket.on('cleared', (strdata) => {
        const url = JSON.parse(strdata);
        currentDownloads.delete(url);
        broadcastEvent('cleared', strdata);
    });

    socket.on('error', (strdata) => {
        console.error('[MeTube] Socket error event:', strdata);
        broadcastEvent('error', strdata);
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
            'splitByChapters', 'chapterTemplate', 'cookieUpload'
        ], async (settings) => {
            const metubeUrl = settings.metubeUrl || DEFAULT_METUBE_URL;
            const download_type = getDownloadType(settings.format || "any", settings.quality || "best");
            const options = {
                url: url,
                quality: settings.quality || "best",
                format: settings.format || "any",
                download_type: download_type,
                codec: "auto",
                folder: settings.folder || "",
                auto_start: settings.autoStart !== undefined ? settings.autoStart : true,
                custom_name_prefix: settings.custom_name_prefix || "",
                playlist_item_limit: settings.playlist_item_limit ? parseInt(settings.playlist_item_limit) : 0,
                split_by_chapters: settings.split_by_chapters || false,
                chapter_template: settings.chapter_template || "",
                subtitle_language: "en",
                subtitle_mode: "prefer_manual"
            };

            const task = {
                baseUrl: metubeUrl,
                options: options,
                cookieUpload: settings.cookieUpload || false,
                tabId: tabId,
                title: pageTitle
            };

            enqueueDownload(task);
        });
    }
});

function getDownloadType(format, quality) {
    const audioFormats = ['m4a', 'mp3', 'opus', 'wav', 'flac'];
    if (audioFormats.includes(format.toLowerCase())) return 'audio';
    if (format.toLowerCase() === 'thumbnail') return 'thumbnail';
    if (format.toLowerCase() === 'captions') return 'captions';
    if (quality.toLowerCase() === 'audio') return 'audio';
    return 'video';
}

function enqueueDownload(task) {

    downloadQueue.push(task);
    processQueue();
}

async function processQueue() {
    if (isProcessingQueue || downloadQueue.length === 0) return;

    isProcessingQueue = true;
    const task = downloadQueue.shift();
    const { baseUrl, options, cookieUpload, tabId, title } = task;

    // Ensure options are compliant with the latest server API
    if (!options.download_type) {
        options.download_type = getDownloadType(options.format || 'any', options.quality || 'best');
    }
    if (options.codec === undefined) options.codec = 'auto';
    if (options.subtitle_language === undefined) options.subtitle_language = 'en';
    if (options.subtitle_mode === undefined) options.subtitle_mode = 'prefer_manual';



    try {
        if (cookieUpload) {
            try {
                await updateCookieStore(options.url);
                await uploadMergedCookies(baseUrl);
            } catch (cookieErr) {
                console.error('[MeTube] Cookie processing failed:', cookieErr);
                // We show notification but continue with download? 
                // Usually better to let user know.
                notifyTab(tabId, 'warning', 'Cookie Upload Failed', cookieErr.message);
            }
        }

        // Notification for "Adding"
        const addingTitle = title ? `Adding: ${title}` : 'Adding to MeTube';
        notifyTab(tabId, 'info', addingTitle, options.url);

        if (tabId) {
            await addPendingAdd(options.url, { tabId: tabId, originalTitle: title });
        }

        const result = await addDownloadToMeTube(baseUrl, options);

        if (result && result.title) {
            notifyTab(tabId, 'success', `Added: ${result.title}`, options.url);
            await clearPendingAdd(options.url);
        }
    } catch (error) {
        console.error('[MeTube] Queue item failed:', error);
        notifyTab(tabId, 'error', 'Failed to add to MeTube', `${error.message}\n${options.url}`);
        if (tabId) await clearPendingAdd(options.url);
    } finally {
        isProcessingQueue = false;
        // Small delay to ensure server isn't hit too hard? 
        // 100ms is usually safe.
        setTimeout(processQueue, 100);
    }
}

async function updateCookieStore(url) {

    const cookies = await chrome.cookies.getAll({ url: url });
    if (cookies && cookies.length > 0) {
        cookies.forEach(c => {
            if (!cookieStore[c.domain]) cookieStore[c.domain] = [];
            const existingIdx = cookieStore[c.domain].findIndex(e => e.name === c.name && e.path === c.path);
            if (existingIdx !== -1) {
                cookieStore[c.domain][existingIdx] = c;
            } else {
                cookieStore[c.domain].push(c);
            }
        });

    }
}

async function uploadMergedCookies(baseUrl) {
    const netscapeContent = getMergedCookiesAsNetscape();
    return await uploadRawCookies(baseUrl, netscapeContent);
}

async function uploadRawCookies(baseUrl, netscapeContent) {
    if (!netscapeContent) return { success: false, msg: 'No cookies to upload' };

    const blob = new Blob([netscapeContent], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('cookies', blob, 'cookies.txt');



    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/upload-cookies`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.msg || 'Server rejected cookie upload');
        }

        return { success: true };
    } catch (err) {
        console.error('[MeTube] Cookie upload failed:', err);
        return { success: false, msg: err.message };
    }
}

async function deleteCookiesFromServer(baseUrl) {
    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/delete-cookies`, {
            method: 'POST'
        });
        const data = await response.json();
        return { success: data.status === 'ok', msg: data.msg };
    } catch (err) {
        console.error('[MeTube] Delete cookies failed:', err);
        return { success: false, msg: err.message };
    }
}

function getMergedCookiesAsNetscape() {
    let output = '# Netscape HTTP Cookie File\n';
    output += '# http://curl.haxx.se/rfc/cookie_spec.html\n';
    output += '# This is a generated file by MeTube Extension!  Do not edit.\n\n';

    let count = 0;
    for (const domain in cookieStore) {
        const cookies = cookieStore[domain];
        cookies.forEach(c => {
            const flag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const expiration = c.expirationDate ? Math.floor(c.expirationDate) : 0;
            const secure = c.secure ? 'TRUE' : 'FALSE';
            output += `${c.domain}\t${flag}\t${c.path}\t${secure}\t${expiration}\t${c.name}\t${c.value}\n`;
            count++;
        });
    }

    return count > 0 ? output : null;
}

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
    } else if (message.type === 'GET_STATE') {
        // Send current state to popup with pagination
        const limit = message.limit || 50; 
        const offset = message.offset || 0;

        let items = Array.from(currentDownloads.values());
        // Sort by timestamp descending
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const total = items.length;
        const slice = items.slice(offset, offset + limit);

        sendResponse({
            downloads: slice.map(i => [i.url, i]),
            connected: socket && socket.connected,
            total: total
        });
    } else if (message.type === 'QUEUE_DOWNLOAD') {
        enqueueDownload(message.task);
        sendResponse({ success: true });
    } else if (message.type === 'UPLOAD_SITE_COOKIES') {
        (async () => {
            try {
                await updateCookieStore(message.url);
                const result = await uploadMergedCookies(message.baseUrl);
                sendResponse(result);
            } catch (err) {
                console.error('[MeTube] Site cookie upload failed:', err);
                sendResponse({ success: false, msg: err.message });
            }
        })();
    } else if (message.type === 'UPLOAD_RAW_COOKIES') {
        uploadRawCookies(message.baseUrl, message.text)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, msg: err.message }));
    } else if (message.type === 'DELETE_COOKIES') {
        deleteCookiesFromServer(message.baseUrl)
            .then(sendResponse)
            .catch(err => sendResponse({ success: false, msg: err.message }));
    } else if (message.type === 'GET_COOKIE_STATUS') {
        fetch(`${message.baseUrl.replace(/\/$/, '')}/cookie-status`)
            .then(r => r.json())
            .then(data => sendResponse({ success: true, has_cookies: data.has_cookies }))
            .catch(err => {
                console.error('[MeTube] Cookie status check failed:', err);
                sendResponse({ success: false, msg: err.message });
            });
    } else if (message.type === 'GET_VERSION') {
        fetch(`${message.baseUrl.replace(/\/$/, '')}/version`)
            .then(r => r.json())
            .then(data => sendResponse({ success: true, version: data.version, yt_dlp: data['yt-dlp'] }))
            .catch(err => sendResponse({ success: false, msg: err.message }));
    } else if (message.type === 'CLEAR_COOKIE_STORE') {
        cookieStore = {};
        sendResponse({ success: true });
    }
    return true; // Keep channel open for sendResponse
});
