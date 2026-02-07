
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(['metubeUrl'], (result) => {
        if (!result.metubeUrl) {
            chrome.storage.sync.set({ metubeUrl: 'http://localhost:8081' });
        }
    });
});
