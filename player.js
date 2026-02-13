document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);

    // Robust decoding helper
    function robustDecode(str) {
        if (!str) return null;
        try {
            return decodeURIComponent(escape(atob(str)));
        } catch (e) {
            return decodeURIComponent(str); // Fallback to standard
        }
    }

    const videoUrl = robustDecode(urlParams.get('b64_url')) || urlParams.get('url');
    const rawTitle = robustDecode(urlParams.get('b64_title')) || urlParams.get('title');

    function getMediaInfo(url) {
        let path = url;
        try {
            path = new URL(url).pathname;
        } catch (e) { }
        const ext = path.split('.').pop().toLowerCase();
        const videoExts = {
            'mp4': 'video/mp4',
            'mkv': 'video/x-matroska',
            'webm': 'video/webm',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'flv': 'video/x-flv',
            'm4v': 'video/x-m4v',
            'mpg': 'video/mpeg',
            'mpeg': 'video/mpeg',
            'wmv': 'video/x-ms-wmv',
            'ts': 'video/mp2t',
            'ogv': 'video/ogg'
        };
        const audioExts = {
            'mp3': 'audio/mpeg',
            'm4a': 'audio/mp4',
            'flac': 'audio/flac',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'oga': 'audio/ogg',
            'aac': 'audio/aac',
            'opus': 'audio/opus'
        };

        if (videoExts[ext]) return { type: 'video', mime: videoExts[ext] };
        if (audioExts[ext]) return { type: 'audio', mime: audioExts[ext] };
        return { type: 'video', mime: 'video/mp4' }; // Fallback
    }

    if (rawTitle) {
        // Strip any trailing extension (2-4 chars after a dot)
        const cleanTitle = rawTitle.replace(/\.[a-z0-9]{2,4}$/i, "");
        document.title = cleanTitle;
    }

    const player = new Plyr('#player', {
        controls: [
            'play-large', // The large play button in the center
            'play', // Play/pause playback
            'progress', // The progress bar and scrubber for playback and buffering
            'current-time', // The current time of playback
            'mute', // Toggle mute
            'volume', // Volume control
            'captions', // Toggle captions
            'settings', // Settings menu
            'airplay', // Airplay (currently Safari only)
            'fullscreen', // Toggle fullscreen
        ]
    });

    // Safe play helper to avoid AbortError
    function safePlay(plyr) {
        const promise = plyr.play();
        if (promise !== undefined) {
            promise.catch(error => {
                if (error.name === 'AbortError') {
                    // Ignore, this happens when play() is requested but then interrupted
                } else {
                    console.error('Playback error:', error);
                }
            });
        }
    }

    if (videoUrl) {
        const mediaInfo = getMediaInfo(videoUrl);
        // Check availability first
        fetch(videoUrl, { method: 'HEAD' })
            .then(response => {
                if (response.status === 404) {
                    document.getElementById('player').style.display = 'none';
                    document.querySelector('.plyr').style.display = 'none'; // Plyr wrapper
                    document.getElementById('error-message').style.display = 'block';
                    document.title = 'Error: Media Not Found';
                    return;
                }

                const videoElement = document.getElementById('player');
                const source = videoElement.querySelector('source');
                source.src = videoUrl;
                source.type = mediaInfo.mime;

                player.source = {
                    type: mediaInfo.type,
                    sources: [
                        {
                            src: videoUrl,
                            type: mediaInfo.mime,
                        },
                    ],
                };

                // Auto play
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
