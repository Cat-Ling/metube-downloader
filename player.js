document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const videoUrl = urlParams.get('url');
    const rawTitle = urlParams.get('title');

    if (rawTitle) {
        // Strip extension (lazy regex: last dot to end)
        const cleanTitle = rawTitle.replace(/\.[^/.]+$/, "");
        document.title = cleanTitle;
    }

    const player = new Plyr('#player');

    if (videoUrl) {
        // Check availability first
        fetch(videoUrl, { method: 'HEAD' })
            .then(response => {
                if (response.status === 404) {
                    document.getElementById('player').style.display = 'none';
                    document.querySelector('.plyr').style.display = 'none'; // Plyr wrapper
                    document.getElementById('error-message').style.display = 'block';
                    document.title = 'Error: Video Not Found';
                    return;
                }

                const videoElement = document.getElementById('player');
                const source = videoElement.querySelector('source');
                source.src = videoUrl;

                // Try to determine type from extension, default to mp4
                if (videoUrl.endsWith('.mkv')) {
                    source.type = 'video/x-matroska';
                } else if (videoUrl.endsWith('.webm')) {
                    source.type = 'video/webm';
                } else {
                    source.type = 'video/mp4';
                }

                player.source = {
                    type: 'video',
                    sources: [
                        {
                            src: videoUrl,
                            type: source.type,
                        },
                    ],
                };

                // Auto play
                player.on('ready', () => {
                    player.play();
                });
            })
            .catch(err => {
                console.error('Error checking video:', err);
                // Fallback to trying to play anyway if fetch fails (e.g. CORS)
                // or show generic error? For now, let's assume if HEAD fails, something is wrong.
                // But CORS might block HEAD. 
                // MeTube usually allows CORS. If not, this check might fail falsely.
                // Let's rely on plyr error or just try playing if it's not explicitly 404.

                const videoElement = document.getElementById('player');
                const source = videoElement.querySelector('source');
                source.src = videoUrl;
                player.source = {
                    type: 'video',
                    sources: [{ src: videoUrl, type: 'video/mp4' }]
                };
                player.play();
            });
    }
});
