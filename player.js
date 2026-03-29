document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);

    // Robust decoding helper
    function robustDecode(str) {
        if (!str) return null;
        try {
            // Using a more robust strategy for UTF-8 Base64
            // First decode from URL encoding if present, then atob, then UTF-8 decode
            const base64 = decodeURIComponent(str);
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        } catch (e) {
            try {
                // Fallback to the old escape trick
                return decodeURIComponent(escape(atob(decodeURIComponent(str))));
            } catch (err) {
                console.error('Decoding failed for:', str, err);
                return str; 
            }
        }
    }

    const videoUrl = robustDecode(urlParams.get('b64_url')) || urlParams.get('url');
    const rawTitle = robustDecode(urlParams.get('b64_title')) || urlParams.get('title');
    const mediaType = robustDecode(urlParams.get('b64_type')) || 'video';
    const posterUrl = robustDecode(urlParams.get('b64_poster'));

    function getMediaInfo(url) {
        let path = url;
        try {
            path = new URL(url).pathname;
        } catch (e) { }
        const ext = path.split('.').pop().toLowerCase();
        const videoExts = {
            'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'webm': 'video/webm',
            'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'flv': 'video/x-flv',
            'm4v': 'video/x-m4v', 'mpg': 'video/mpeg', 'mpeg': 'video/mpeg',
            'wmv': 'video/x-ms-wmv', 'ts': 'video/mp2t', 'ogv': 'video/ogg'
        };
        const audioExts = {
            'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'flac': 'audio/flac',
            'wav': 'audio/wav', 'ogg': 'audio/ogg', 'oga': 'audio/ogg',
            'aac': 'audio/aac', 'opus': 'audio/opus'
        };

        if (videoExts[ext]) return { type: 'video', mime: videoExts[ext] };
        if (audioExts[ext]) return { type: 'audio', mime: audioExts[ext] };
        return { type: mediaType || 'video', mime: (mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4') };
    }

    if (rawTitle) {
        const cleanTitle = rawTitle.replace(/\.[a-z0-9]{2,4}$/i, "");
        document.title = cleanTitle;
        const titleEl = document.getElementById('media-title');
        if (titleEl) titleEl.textContent = cleanTitle;
    }

    const isAudio = mediaType === 'audio';
    if (isAudio) {
        document.body.classList.add('audio-mode');
    }

    const player = new Plyr('#player', {
        controls: [
            'play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'airplay', 'fullscreen'
        ],
        // If it's audio, we can also add 'duration' and 'restart'
        ratio: isAudio ? '1:1' : '16:9'
    });

    if (isAudio && posterUrl) {
        document.getElementById('poster-container').style.display = 'block';
        document.getElementById('poster-img').src = posterUrl;
        document.getElementById('main-poster').src = posterUrl;
        // Don't hide the player completely, just make it background-less
        const playerEl = document.getElementById('player');
        if (playerEl) {
            playerEl.style.background = 'transparent';
        }
    }

    // Safe play helper to avoid AbortError
    function safePlay(plyr) {
        const promise = plyr.play();
        if (promise !== undefined) {
            promise.catch(error => {
                if (error.name === 'AbortError') { /* ignored */ } 
                else { console.error('Playback error:', error); }
            });
        }
    }

    if (videoUrl) {
        const info = getMediaInfo(videoUrl);
        
        fetch(videoUrl, { method: 'HEAD' })
            .then(response => {
                if (response.status === 404) {
                    document.getElementById('player').style.display = 'none';
                    if (document.querySelector('.plyr')) document.querySelector('.plyr').style.display = 'none';
                    document.getElementById('poster-container').style.display = 'none';
                    document.getElementById('error-message').style.display = 'block';
                    document.title = 'Error: Media Not Found';
                    return;
                }

                // Force 'video' type even for audio to get the minimal auto-hiding UI
                // Plyr handles audio in a video tag just fine.
                player.source = {
                    type: 'video', 
                    title: rawTitle,
                    poster: posterUrl, // Native Plyr poster support
                    sources: [{ src: videoUrl, type: info.mime }]
                };

                player.on('ready', () => {
                    safePlay(player);
                });

                // Keyboard Shortcuts
                document.addEventListener('keydown', (e) => {
                    // Ignore if typing in an input (just in case)
                    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
                        return;
                    }

                    const key = e.key.toLowerCase();

                    switch (key) {
                        case 'k':
                        case ' ':
                            e.preventDefault();
                            player.togglePlay();
                            break;
                        case 'j':
                            e.preventDefault();
                            player.currentTime = Math.max(0, player.currentTime - 10);
                            break;
                        case 'l':
                            e.preventDefault();
                            player.currentTime = Math.min(player.duration, player.currentTime + 10);
                            break;
                        case 'f':
                            e.preventDefault();
                            player.fullscreen.toggle();
                            break;
                        case 'm':
                            e.preventDefault();
                            player.muted = !player.muted;
                            break;
                        case 'arrowleft':
                            e.preventDefault();
                            player.currentTime = Math.max(0, player.currentTime - 5);
                            break;
                        case 'arrowright':
                            e.preventDefault();
                            player.currentTime = Math.min(player.duration, player.currentTime + 5);
                            break;
                        case 'arrowup':
                            e.preventDefault();
                            player.volume = Math.min(1, player.volume + 0.05);
                            break;
                        case 'arrowdown':
                            e.preventDefault();
                            player.volume = Math.max(0, player.volume - 0.05);
                            break;
                        case '<': // Shift + ,
                            e.preventDefault();
                            player.speed = Math.max(0.25, player.speed - 0.25);
                            break;
                        case '>': // Shift + .
                            e.preventDefault();
                            player.speed = Math.min(2, player.speed + 0.25);
                            break;
                    }

                    // Seek to 0%-90% with number keys
                    if (/^\d$/.test(key)) {
                        e.preventDefault();
                        const percent = parseInt(key) * 10;
                        if (!isNaN(player.duration)) {
                            player.currentTime = (percent / 100) * player.duration;
                        }
                    }
                });
            })
            .catch(err => {
                console.error('Error checking media availability:', err);
                const mediaInfo = getMediaInfo(videoUrl);
                const videoElement = document.getElementById('player');
                const source = videoElement.querySelector('source');
                source.src = videoUrl;
                source.type = mediaInfo.mime;
                player.source = {
                    type: mediaInfo.type,
                    sources: [{ src: videoUrl, type: mediaInfo.mime }]
                };
                safePlay(player);
            });
    }
});
