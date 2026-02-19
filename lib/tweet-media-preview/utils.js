(function() {
  'use strict';

  function extractTweetId(url, tweetRegex) {
    const source = String(url || '');
    const rx = tweetRegex instanceof RegExp ? tweetRegex : /https:\/\/(x|twitter|xcancel)\.com\/.*?\/status\/(\d+)/i;
    const match = rx.exec(source);
    return match ? match[2] : null;
  }

  function tweetHasVideo(info) {
    return Array.isArray(info && info.media_attachments)
      && info.media_attachments.some((attachment) => attachment && (attachment.type === 'video' || attachment.type === 'gifv'));
  }

  function buildVideoSourceCandidates() {
    const urls = Array.from(arguments);
    const candidates = [];
    const seen = new Set();

    const addCandidate = (url) => {
      const value = String(url || '').trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      candidates.push(value);
    };

    urls.forEach(addCandidate);

    const baseCandidates = candidates.slice();
    baseCandidates.forEach((url) => {
      if (!/video\.twimg\.com/i.test(url) || url.includes('?')) {
        return;
      }
      addCandidate(`${url}?tag=14`);
      addCandidate(`${url}?tag=16`);
      addCandidate(`${url}?tag=12`);
    });

    return candidates;
  }

  function attachVideoSourceWithFallback(video, sourceCandidates, fallbackLink) {
    const sources = Array.isArray(sourceCandidates) ? sourceCandidates : [];
    if (!video || !fallbackLink) {
      return;
    }
    if (!sources.length) {
      video.style.display = 'none';
      fallbackLink.style.display = 'block';
      return;
    }

    let sourceIndex = 0;
    fallbackLink.href = sources[0];

    const loadAt = (index) => {
      if (index >= sources.length) {
        video.style.display = 'none';
        fallbackLink.style.display = 'block';
        return;
      }
      sourceIndex = index;
      video.src = sources[sourceIndex];
      video.load();
    };

    video.addEventListener('error', () => {
      loadAt(sourceIndex + 1);
    });

    loadAt(0);
  }

  window.CytubeTweetMediaPreviewUtils = Object.freeze({
    extractTweetId,
    tweetHasVideo,
    buildVideoSourceCandidates,
    attachVideoSourceWithFallback
  });
})();
