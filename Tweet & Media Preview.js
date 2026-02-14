// ==UserScript==
// @name         Tweet & Media Preview
// @namespace    http://tampermonkey.net/
// @version      2026.02.17
// @description  Inline tweet + media
// @author       You
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = 'tweetPreviewEnabled';
  const TOGGLE_ID = 'tweet-main-toggle';
  const RETRY_DELAY_MS = 500;
  const MAX_RETRIES = 120;

  const API_BASE = 'https://unable-diet-least-attorneys.trycloudflare.com';
  const API_ORIGIN = new URL(API_BASE).origin;
  const tweetRegex = /https:\/\/(x|twitter|xcancel)\.com\/.*?\/status\/(\d+)/i;
  const mediaRegex = /\.(jpe?g|png|gif|webp|mp4|webm|mov)(\?.*)?$/i;
  const allMediaLinkSelector = "a[href*='twitter.com'], a[href*='x.com'], a[href*='xcancel.com'], a[href*='.jpg'], a[href*='.jpeg'], a[href*='.png'], a[href*='.gif'], a[href*='.webp'], a[href*='.mp4'], a[href*='.webm'], a[href*='.mov']";

  let tweetPreviewActive = readStoredEnabled();
  const tweetInfoCache = {};
  const tweetVideoSourcesCache = {};

  function readStoredEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch (err) {
      return true;
    }
  }

  function saveStoredEnabled(value) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch (err) {
      // Ignore storage failures to keep runtime behavior stable.
    }
  }

  function removeAllPreviews() {
    document
      .querySelectorAll('.tweet-inline-preview, .tweet-preview-toggle, .media-preview-toggle')
      .forEach((el) => el.remove());
  }

  function scanExistingLinks() {
    document.querySelectorAll(allMediaLinkSelector).forEach(addPreviewIfTweetOrMedia);
  }

  function createMainToggle(attempt = 0) {
    const container = document.getElementById('tools-button-container');
    if (!container) {
      if (attempt < MAX_RETRIES) {
        setTimeout(() => createMainToggle(attempt + 1), RETRY_DELAY_MS);
      }
      return;
    }

    if (document.getElementById(TOGGLE_ID)) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.className = 'btn btn-sm btn-default';
    btn.textContent = '🐦';
    btn.style.marginLeft = '5px';
    btn.classList.toggle('active', tweetPreviewActive);
    btn.addEventListener('click', () => {
      tweetPreviewActive = !tweetPreviewActive;
      saveStoredEnabled(tweetPreviewActive);
      btn.classList.toggle('active', tweetPreviewActive);

      if (!tweetPreviewActive) {
        removeAllPreviews();
      } else {
        scanExistingLinks();
      }
    });

    container.appendChild(btn);
  }

  async function fetchTweetInfo(tweetUrl) {
    const match = tweetRegex.exec(tweetUrl);
    const tweetId = match ? match[2] : null;
    if (!tweetId || tweetInfoCache[tweetId]) {
      return tweetInfoCache[tweetId] || null;
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/statuses/${tweetId}`);
      const data = await res.json();
      tweetInfoCache[tweetId] = data;
      return data;
    } catch (err) {
      console.error('Tweet fetch failed:', err);
      return null;
    }
  }

  function extractTweetId(url) {
    const match = tweetRegex.exec(url || '');
    return match ? match[2] : null;
  }

  async function fetchSyndicationVideoSources(tweetUrl) {
    const tweetId = extractTweetId(tweetUrl);
    if (!tweetId) {
      return [];
    }

    if (tweetVideoSourcesCache[tweetId]) {
      return tweetVideoSourcesCache[tweetId];
    }

    try {
      const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`);
      if (!res.ok) {
        tweetVideoSourcesCache[tweetId] = [];
        return [];
      }

      const data = await res.json();
      const mediaDetails = Array.isArray(data.mediaDetails)
        ? data.mediaDetails
        : (Array.isArray(data.media_details) ? data.media_details : []);

      const urls = [];
      mediaDetails.forEach((item) => {
        const variants = item?.video_info?.variants || item?.videoInfo?.variants || [];
        variants.forEach((variant) => {
          const contentType = variant.content_type || variant.contentType || '';
          if (!/video\/mp4/i.test(contentType)) {
            return;
          }
          if (variant.url) {
            urls.push(variant.url);
          }
        });
      });

      const deduped = [...new Set(urls)];
      tweetVideoSourcesCache[tweetId] = deduped;
      return deduped;
    } catch (err) {
      tweetVideoSourcesCache[tweetId] = [];
      return [];
    }
  }

  function tweetHasVideo(info) {
    return Array.isArray(info?.media_attachments) && info.media_attachments.some((a) => a?.type === 'video' || a?.type === 'gifv');
  }

  function createTweetIframe(tweetId) {
    const iframe = document.createElement('iframe');
    iframe.allow = 'fullscreen';
    iframe.src = `${API_BASE}/embed-iframe/${tweetId}`;
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.height = '420';
    iframe.dataset.tweetIframe = '1';
    return iframe;
  }

  function initIframeMessageBridge() {
    if (window.__tweetPreviewIframeBridgeInit) {
      return;
    }
    window.__tweetPreviewIframeBridgeInit = true;

    window.addEventListener('message', (event) => {
      if (event.origin !== API_ORIGIN) {
        return;
      }

      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (err) {
          return;
        }
      }

      if (!data || typeof data !== 'object' || !data.src) {
        return;
      }

      const iframes = document.querySelectorAll(`iframe[src^="${data.src}"]`);
      if (data.context === 'iframe.error') {
        iframes.forEach((iframe) => {
          iframe.style.display = 'none';
          const fallback = iframe.nextElementSibling;
          if (fallback && fallback.classList.contains('tweet-video-fallback-link')) {
            fallback.style.display = 'block';
          }
        });
        return;
      }

      if (data.context === 'iframe.resize') {
        const height = Number(data.height);
        if (!Number.isFinite(height) || height <= 0) {
          return;
        }
        iframes.forEach((iframe) => {
          iframe.height = String(height + 50);
        });
      }
    });
  }

  async function buildEmbed(info, tweetUrl) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="tweet-content">
        <div class="tweet-user">
          <div class="tweet-avatar"><img src="${info.account.avatar}" width="40" height="40" style="border-radius:50%;"></div>
          <div class="tweet-user-id">
            <span class="tweet-user-name">${info.account.display_name}</span>
            <span class="tweet-user-handle">@${info.account.acct}</span>
          </div>
        </div>
        <div class="tweet-text">${info.content}</div>
        <div class="tweet-image"></div>
      </div>
    `;

    const syndicationSources = await fetchSyndicationVideoSources(tweetUrl);
    const imageContainer = wrapper.querySelector('.tweet-image');
    info.media_attachments.forEach((attachment) => {
      const mediaWrapper = document.createElement('div');

      if (attachment.type === 'video' || attachment.type === 'gifv') {
        const sourceCandidates = buildVideoSourceCandidates(attachment.url, attachment.remote_url, ...syndicationSources);
        const video = document.createElement('video');
        video.controls = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.poster = attachment.preview_url || '';
        video.style.cssText = 'width:100%; border-radius:6px; display:block; background:#000;';

        const fallbackLink = document.createElement('a');
        fallbackLink.href = sourceCandidates[0] || attachment.url || attachment.remote_url || '#';
        fallbackLink.target = '_blank';
        fallbackLink.style.cssText = 'display:none; padding:10px; color:#f88; text-align:center;';
        fallbackLink.textContent = '⚠️ Video blocked. Click to watch externally.';

        mediaWrapper.appendChild(video);
        mediaWrapper.appendChild(fallbackLink);
        attachVideoSourceWithFallback(video, sourceCandidates, fallbackLink);
      } else {
        mediaWrapper.innerHTML = `<a href="${attachment.url}" target="_blank" referrerpolicy="no-referrer"><img src="${attachment.preview_url}" style="width:100%; border-radius:6px; display:block;"></a>`;
      }

      imageContainer.appendChild(mediaWrapper);
    });

    return wrapper.firstElementChild;
  }

  function findMessageContainer(link) {
    return link.closest('div[id^="msg-"]') || link.parentElement?.parentElement || null;
  }

  function addPreviewIfTweetOrMedia(link) {
    const messageEl = findMessageContainer(link);
    if (!messageEl || messageEl.querySelector('.tweet-preview-toggle, .media-preview-toggle')) {
      return;
    }

    if (tweetRegex.test(link.href)) {
      addTweetPreview(link, messageEl);
    } else if (mediaRegex.test(link.href)) {
      addMediaPreview(link, messageEl);
    }
  }

  function buildVideoSourceCandidates(...urls) {
    const candidates = [];
    const seen = new Set();

    function addCandidate(url) {
      const value = (url || '').trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      candidates.push(value);
    }

    urls.forEach(addCandidate);

    const baseCandidates = [...candidates];
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
    if (!sourceCandidates.length) {
      video.style.display = 'none';
      fallbackLink.style.display = 'block';
      return;
    }

    let sourceIndex = 0;
    fallbackLink.href = sourceCandidates[0];

    const loadAt = (index) => {
      if (index >= sourceCandidates.length) {
        video.style.display = 'none';
        fallbackLink.style.display = 'block';
        return;
      }
      sourceIndex = index;
      video.src = sourceCandidates[sourceIndex];
      video.load();
    };

    video.addEventListener('error', () => {
      loadAt(sourceIndex + 1);
    });

    loadAt(0);
  }

  function addTweetPreview(link, messageEl) {
    const button = createPreviewToggle('tweet-preview-toggle');
    if (!link.parentNode) {
      return;
    }

    link.parentNode.appendChild(button);
    let preview = null;

    button.addEventListener('click', async () => {
      if (preview?.isConnected) {
        preview.remove();
        preview = null;
        return;
      }

      preview = createPreviewContainer();
      messageEl.appendChild(preview);
      const info = await fetchTweetInfo(link.href);
      const embed = preview.querySelector('.tweet-embed');

      if (info) {
        embed.style.display = 'block';
        preview.querySelector('.tweet-loader')?.remove();
        const tweetId = extractTweetId(link.href);
        if (tweetId && tweetHasVideo(info)) {
          const iframe = createTweetIframe(tweetId);
          const fallbackLink = document.createElement('a');
          fallbackLink.href = link.href;
          fallbackLink.target = '_blank';
          fallbackLink.referrerPolicy = 'no-referrer';
          fallbackLink.className = 'tweet-video-fallback-link';
          fallbackLink.style.cssText = 'display:none; padding:10px; color:#f88; text-align:center;';
          fallbackLink.textContent = '⚠️ Video blocked. Click to watch externally.';
          embed.replaceChildren(iframe, fallbackLink);
        } else {
          embed.appendChild(await buildEmbed(info, link.href));
        }
      } else {
        preview.innerHTML = '<div style="color:#ff6b6b;padding:6px;font-size:13px;">Failed to load tweet</div>';
      }
    });
  }

  function addMediaPreview(link, messageEl) {
    const button = createPreviewToggle('media-preview-toggle');
    if (!link.parentNode) {
      return;
    }

    link.parentNode.appendChild(button);
    let preview = null;

    button.addEventListener('click', () => {
      if (preview?.isConnected) {
        preview.remove();
        preview = null;
        return;
      }

      preview = createPreviewContainer();
      const embed = preview.querySelector('.tweet-embed');
      embed.style.display = 'block';
      const isVideo = /\.(mp4|webm|mov)$/i.test(link.href);

      if (isVideo) {
        const sourceCandidates = buildVideoSourceCandidates(link.href);
        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.muted = true;
        video.style.cssText = 'width:100%; max-height:80vh; border-radius:6px; display:block; background:#000;';

        const fallbackLink = document.createElement('a');
        fallbackLink.href = sourceCandidates[0] || link.href;
        fallbackLink.target = '_blank';
        fallbackLink.referrerPolicy = 'no-referrer';
        fallbackLink.style.cssText = 'display:none; padding:10px; color:#f88; text-align:center;';
        fallbackLink.textContent = '⚠️ Video blocked. Click to watch externally.';

        embed.replaceChildren(video, fallbackLink);
        attachVideoSourceWithFallback(video, sourceCandidates, fallbackLink);
      } else {
        embed.innerHTML = `<a href="${link.href}" target="_blank" referrerpolicy="no-referrer"><img src="${link.href}" style="width:100%; border-radius:6px; display:block;" loading="lazy"></a>`;
      }

      preview.querySelector('.tweet-loader')?.remove();
      messageEl.appendChild(preview);
    });
  }

  function createPreviewToggle(className) {
    const button = document.createElement('button');
    button.className = className;
    button.textContent = '👁️';
    button.style.cssText = 'margin-left:6px;background:transparent;border:none;cursor:pointer;font-size:11px;opacity:0.8;padding:1px 5px;';
    return button;
  }

  function createPreviewContainer() {
    const container = document.createElement('div');
    container.className = 'tweet-inline-preview';
    container.innerHTML = '<div class="tweet-loader" style="width:60px;height:12px;background:radial-gradient(circle closest-side,#fff 90%,#0000) 0/calc(100%/3) 100% space;animation:tweetanim 1s steps(4) infinite;margin:6px 0;"></div><div class="tweet-embed" style="display:none"></div>';
    return container;
  }

  async function waitForMessageProcessor() {
    while (true) {
      if (typeof waitForFunc !== 'undefined') {
        await waitForFunc('MESSAGE_PROCESSOR');
        return typeof MESSAGE_PROCESSOR !== 'undefined' ? MESSAGE_PROCESSOR : null;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  GM_addStyle(`
    @keyframes tweetanim {to{clip-path:inset(0 -34% 0 0)}}
    #${TOGGLE_ID}.active {background:#337ab7 !important; border-color:#2e6da4 !important;}
    .tweet-inline-preview {background:#000;color:#fff;border:1px solid #2f3336;border-radius:8px;max-width:350px;font-family:system-ui;margin:4px 0;padding:0;overflow:hidden;}
    .tweet-content {display:flex;flex-direction:column;padding:8px;}
    .tweet-user {display:flex;gap:8px;align-items:center;margin-bottom:6px;}
    .tweet-user-name {font-weight:bold;font-size:14px;}
    .tweet-user-handle {color:#71767b;font-size:13px;}
    .tweet-text {font-size:14px;white-space:pre-wrap;margin:0 0 8px 0;}
    .tweet-image {display:grid;grid-template-columns:1fr 1fr;gap:4px;}
    .tweet-image > div {overflow:hidden;border-radius:6px;background:#111;}
    .tweet-image img, .tweet-image video {width:100%; height:auto; display:block;}
    .tweet-image :nth-child(1):nth-last-child(1){grid-column:span 2;}
  `);

  (async () => {
    initIframeMessageBridge();
    createMainToggle();
    scanExistingLinks();

    const messageProcessor = await waitForMessageProcessor();
    if (!messageProcessor) {
      return;
    }

    messageProcessor.addTap(($msg) => {
      if (!tweetPreviewActive) {
        return;
      }
      $msg.find('a').each((_, el) => addPreviewIfTweetOrMedia(el));
    });
  })();
})();
