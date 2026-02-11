// content-script.js

// Define CSS in a variable to inject into Shadow DOM
const NOTIFICATION_CSS = `
    :host {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        pointer-events: none;
    }

    .metube-notification-toast {
        background-color: #1e293b;
        color: #f8fafc;
        padding: 16px;
        border-radius: 12px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 320px;
        max-width: calc(100vw - 40px);
        border: 1px solid #334155;
        font-size: 14px;
        pointer-events: auto;
        margin-top: 10px;
        animation: metubeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transition: transform 0.3s ease, opacity 0.3s ease;
        position: relative;
    }

    .metube-notification-toast.error { border-left: 4px solid #ef4444; }
    .metube-notification-toast.success { border-left: 4px solid #22c55e; }
    .metube-notification-toast.info { border-left: 4px solid #3b82f6; }

    .metube-notification-header {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .metube-notification-header span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .metube-notification-body {
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.4;
        word-break: break-all;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .metube-progress-bar {
        height: 3px;
        background-color: #334155;
        border-radius: 2px;
        overflow: hidden;
        margin-top: 4px;
    }

    .metube-progress-fill {
        height: 100%;
        background-color: #8b5cf6;
        width: 100%;
        transition: width 5s linear;
    }

    @keyframes metubeSlideIn {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }

    .metube-slide-out {
        transform: translateY(20px);
        opacity: 0;
    }
`;

let shadowHost = null;
let shadowRoot = null;

function ensureShadowHost() {
    if (!shadowHost || !shadowHost.parentElement) {
        shadowHost = document.createElement('div');
        shadowHost.id = 'metube-notification-host';
        // Ensure it's not hidden by page styles
        shadowHost.style.display = 'block';
        shadowHost.style.visibility = 'visible';
        shadowHost.style.opacity = '1';
        document.body.appendChild(shadowHost);

        shadowRoot = shadowHost.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = NOTIFICATION_CSS;
        shadowRoot.appendChild(style);

        // Container for toasts to handle stacking easily
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.style.display = 'flex';
        container.style.flexDirection = 'column-reverse'; // Stack upwards
        shadowRoot.appendChild(container);
    }
    return shadowRoot.getElementById('toast-container');
}

function showNotification(type, title, message) {
    const container = ensureShadowHost();
    const toast = document.createElement('div');
    toast.className = `metube-notification-toast ${type}`;

    let icon = '';
    if (type === 'success') {
        icon = `<svg style="width:20px;height:20px;min-width:20px;fill:#22c55e;" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else if (type === 'error') {
        icon = `<svg style="width:20px;height:20px;min-width:20px;fill:#ef4444;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    } else {
        icon = `<svg style="width:20px;height:20px;min-width:20px;fill:#3b82f6;" viewBox="0 0 24 24"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`;
    }

    toast.innerHTML = `
        <div class="metube-notification-header">
            <span class="metube-icon-container"></span>
            <span class="metube-title"></span>
        </div>
        <div class="metube-notification-body"></div>
        <div class="metube-progress-bar">
            <div class="metube-progress-fill"></div>
        </div>
    `;

    // Securely set text content to prevent XSS
    toast.querySelector('.metube-icon-container').innerHTML = icon;
    toast.querySelector('.metube-title').textContent = title;
    toast.querySelector('.metube-notification-body').textContent = message;

    container.appendChild(toast);

    // Animate progress bar
    const fill = toast.querySelector('.metube-progress-fill');
    void fill.offsetWidth;
    fill.style.width = '0%';

    // Remove after 5 seconds
    setTimeout(() => {
        toast.classList.add('metube-slide-out');
        toast.addEventListener('transitionend', () => {
            toast.remove();
            // If no more toasts, we could potentially remove the host, 
            // but keeping it is safer for performance.
        }, { once: true });
    }, 5000);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_NOTIFICATION') {
        showNotification(message.status, message.title, message.message);
        sendResponse({ received: true });
    }
    return true; // Keep channel open for async if needed, though we sendResponse immediately
});
