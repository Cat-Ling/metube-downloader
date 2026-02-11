// content-script.js

// Create and inject CSS
const style = document.createElement('style');
style.textContent = `
    .metube-notification-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: #1e293b;
        color: #f8fafc;
        padding: 16px;
        border-radius: 12px;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        z-index: 2147483647; /* Max z-index */
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 250px;
        border: 1px solid #334155;
        animation: metubeSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        font-size: 14px;
    }

    .metube-notification-toast.error {
        border-left: 4px solid #ef4444;
    }

    .metube-notification-toast.success {
        border-left: 4px solid #22c55e;
    }

    .metube-notification-toast.info {
        border-left: 4px solid #3b82f6;
    }

    .metube-notification-header {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .metube-notification-body {
        color: #94a3b8;
        font-size: 13px;
        line-height: 1.4;
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
        transition: width linear;
    }

    @keyframes metubeSlideIn {
        from {
            transform: translateY(20px);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    @keyframes metubeSlideOut {
        from {
            transform: translateY(0);
            opacity: 1;
        }
        to {
            transform: translateY(20px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

function showNotification(type, title, message) {
    const toast = document.createElement('div');
    toast.className = `metube-notification-toast ${type}`;

    // Icon based on type
    let icon = '';
    if (type === 'success') {
        icon = `<svg style="width:20px;height:20px;fill:#22c55e;" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else if (type === 'error') {
        icon = `<svg style="width:20px;height:20px;fill:#ef4444;" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    } else {
        // Info / Default
        icon = `<svg style="width:20px;height:20px;fill:#3b82f6;" viewBox="0 0 24 24"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>`;
    }

    toast.innerHTML = `
        <div class="metube-notification-header">
            ${icon}
            <span>${title}</span>
        </div>
        <div class="metube-notification-body">${message}</div>
        <div class="metube-progress-bar">
            <div class="metube-progress-fill"></div>
        </div>
    `;

    document.body.appendChild(toast);

    // Animate progress bar
    const fill = toast.querySelector('.metube-progress-fill');

    // Force reflow
    void fill.offsetWidth;

    // Start animation
    fill.style.transition = 'width 5s linear';
    fill.style.width = '0%';

    // Remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'metubeSlideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 5000);
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SHOW_NOTIFICATION') {
        showNotification(request.status, request.title, request.message);
    }
});
