
importScripts('lib/socket.io.min.js');

const DEFAULT_METUBE_URL = 'http://localhost:8081';
let socket = null;

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
}

function notifyActiveTab(status, title, message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SHOW_NOTIFICATION',
                status: status,
                title: title,
                message: message
            }, (response) => {
                if (chrome.runtime.lastError) {
                    // Ignore error if content script is not ready or not injectable
                    // console.log('Notification skipped:', chrome.runtime.lastError.message);
                }
            });
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
});

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
