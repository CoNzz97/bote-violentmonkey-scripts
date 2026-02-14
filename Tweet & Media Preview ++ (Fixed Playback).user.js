// ==UserScript==
// @name         Tweet & Media Preview ++ (Fixed Playback)
// @namespace    http://tampermonkey.net/
// @version      2025.11.15
// @description  Inline tweet + media • Fixed "Greyed Out" Play Button • CORS Fix
// @author       You + Gemini
// @match        https://om3tcw.com/r/*
// @grant        GM_addStyle
// ==/UserScript==

const tweetRegex = /https:\/\/(x|twitter)\.com\/.*?\/status\/(\d+)/i;
const mediaRegex = /\.(jpe?g|png|gif|webp|mp4|webm|mov)(\?.*)?$/i;

let tweetPreviewActive = localStorage.getItem("tweetPreviewEnabled") !== "false";
let tweetInfoCache = {};

function createMainToggle() {
    const appendButton = () => {
        const container = document.getElementById('tools-button-container');
        if (!container) {
            setTimeout(appendButton, 500);
            return;
        }

        if (document.getElementById('tweet-main-toggle')) return;

        const btn = document.createElement('button');
        btn.id = 'tweet-main-toggle';
        btn.className = 'btn btn-sm btn-default';
        btn.textContent = '🐦';
        btn.style.marginLeft = '5px';
        if (tweetPreviewActive) btn.classList.add('active');

        btn.onclick = () => {
            tweetPreviewActive = !tweetPreviewActive;
            localStorage.setItem("tweetPreviewEnabled", tweetPreviewActive);
            btn.classList.toggle('active', tweetPreviewActive);
            if (!tweetPreviewActive) {
                document.querySelectorAll('#tweet-inline-preview, .tweet-preview-toggle, .media-preview-toggle').forEach(el => el.remove());
            } else {
                document.querySelectorAll("a[href*='twitter.com'], a[href*='x.com'], a[href$='.jpg'], a[href$='.jpeg'], a[href$='.png'], a[href$='.gif'], a[href$='.webp'], a[href$='.mp4'], a[href$='.webm'], a[href$='.mov']").forEach(addPreviewIfTweetOrMedia);
            }
        };
        container.appendChild(btn);
    };
    appendButton();
}

async function fetchTweetInfo(tweetUrl) {
    const m = tweetRegex.exec(tweetUrl);
    const id = m ? m[2] : null;
    if (!id || tweetInfoCache[id]) return tweetInfoCache[id] || null;
    try {
        const res = await fetch(`https://unable-diet-least-attorneys.trycloudflare.com/api/v1/statuses/${id}`);
        const data = await res.json();
        tweetInfoCache[id] = data;
        return data;
    } catch (e) { console.error("Tweet fetch failed:", e); return null; }
}

function buildEmbed(info) {
    const div = document.createElement('div');
    div.innerHTML = `
        <div id="tweet-content">
            <div id="tweet-user">
                <div id="tweet-avatar"><img src="${info.account.avatar}" width="40" height="40" style="border-radius:50%;"></div>
                <div id="tweet-user-id">
                    <span id="tweet-user-name">${info.account.display_name}</span>
                    <span id="tweet-user-handle">@${info.account.acct}</span>
                </div>
            </div>
            <div id="tweet-text">${info.content}</div>
            <div id="tweet-image"></div>
        </div>`;
    const container = div.querySelector('#tweet-image');

    info.media_attachments.forEach(att => {
        const w = document.createElement('div');

        // Use remote_url (direct Twitter link) if available, otherwise fallback to url
        const videoSrc = att.remote_url || att.url;

        if (att.type === 'video' || att.type === 'gifv') {
            w.innerHTML = `
                <video
                    controls
                    muted
                    playsinline
                    preload="metadata"
                    referrerpolicy="no-referrer"
                    src="${videoSrc}"
                    poster="${att.preview_url}"
                    style="width:100%; border-radius:6px; display:block; background:#000;"
                    onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
                ></video>
                <a href="${videoSrc}" target="_blank" style="display:none; padding:10px; color:#f88; text-align:center;">
                    ⚠️ Video blocked. Click to watch externally.
                </a>`;
        } else {
            w.innerHTML = `<a href="${att.url}" target="_blank" referrerpolicy="no-referrer"><img src="${att.preview_url}" style="width:100%; border-radius:6px; display:block;"></a>`;
        }
        container.appendChild(w);
    });
    return div.firstElementChild;
}

function addPreviewIfTweetOrMedia(a) {
    const msg = a.closest('div[id^="msg-"]') || a.parentElement.parentElement;
    if (!msg || msg.querySelector('.tweet-preview-toggle, .media-preview-toggle')) return;
    if (tweetRegex.test(a.href)) addTweetPreview(a, msg);
    else if (mediaRegex.test(a.href)) addMediaPreview(a, msg);
}

function addTweetPreview(a, msg) {
    const btn = createPreviewToggle('tweet-preview-toggle');
    a.parentNode.appendChild(btn);
    let preview = null;
    btn.onclick = async () => {
        if (preview?.isConnected) { preview.remove(); preview = null; return; }
        preview = createPreviewContainer();
        msg.appendChild(preview);
        const info = await fetchTweetInfo(a.href);
        const embed = preview.querySelector('#tweet-embed');
        if (info) {
            embed.style.display = 'block';
            preview.querySelector('.tweet-loader')?.remove();
            embed.appendChild(buildEmbed(info));
        } else {
            preview.innerHTML = '<div style="color:#ff6b6b;padding:6px;font-size:13px;">Failed to load tweet</div>';
        }
    };
}

function addMediaPreview(a, msg) {
    const btn = createPreviewToggle('media-preview-toggle');
    a.parentNode.appendChild(btn);
    let preview = null;
    btn.onclick = () => {
        if (preview?.isConnected) { preview.remove(); preview = null; return; }
        preview = createPreviewContainer();
        const embed = preview.querySelector('#tweet-embed');
        embed.style.display = 'block';
        const isVideo = /\.(mp4|webm|mov)$/i.test(a.href);

        embed.innerHTML = isVideo
            ? `<video controls playsinline preload="metadata" muted referrerpolicy="no-referrer" src="${a.href}" style="width:100%; max-height:80vh; border-radius:6px; display:block; background:#000;"></video>`
            : `<a href="${a.href}" target="_blank" referrerpolicy="no-referrer"><img src="${a.href}" style="width:100%; border-radius:6px; display:block;" loading="lazy"></a>`;

        preview.querySelector('.tweet-loader')?.remove();
        msg.appendChild(preview);
    };
}

function createPreviewToggle(className) {
    const btn = document.createElement('button');
    btn.className = className;
    btn.textContent = '👁️';
    btn.style.cssText = 'margin-left:6px;background:transparent;border:none;cursor:pointer;font-size:11px;opacity:0.8;padding:1px 5px;';
    return btn;
}

function createPreviewContainer() {
    const div = document.createElement('div');
    div.id = 'tweet-inline-preview';
    div.innerHTML = `<div class="tweet-loader" style="width:60px;height:12px;background:radial-gradient(circle closest-side,#fff 90%,#0000) 0/calc(100%/3) 100% space;animation:tweetanim 1s steps(4) infinite;margin:6px 0;"></div><div id="tweet-embed" style="display:none"></div>`;
    return div;
}

GM_addStyle(`
    @keyframes tweetanim {to{clip-path:inset(0 -34% 0 0)}}
    #tweet-main-toggle.active {background:#337ab7 !important; border-color:#2e6da4 !important;}
    #tweet-inline-preview {background:#000;color:#fff;border:1px solid #2f3336;border-radius:8px;max-width:350px;font-family:system-ui;margin:4px 0;padding:0;overflow:hidden;}
    #tweet-content {display:flex;flex-direction:column;padding:8px;}
    #tweet-user {display:flex;gap:8px;align-items:center;margin-bottom:6px;}
    #tweet-user-name {font-weight:bold;font-size:14px;}
    #tweet-user-handle {color:#71767b;font-size:13px;}
    #tweet-text {font-size:14px;white-space:pre-wrap;margin:0 0 8px 0;}
    #tweet-image {display:grid;grid-template-columns:1fr 1fr;gap:4px;}
    #tweet-image > div {overflow:hidden;border-radius:6px;background:#111;}
    #tweet-image img, #tweet-image video {width:100%; height:auto; display:block;}
    #tweet-image :nth-child(1):nth-last-child(1){grid-column:span 2;}
`);

(async () => {
    while (typeof waitForFunc === 'undefined') await new Promise(r => setTimeout(r, 200));
    await waitForFunc("MESSAGE_PROCESSOR");
    createMainToggle();
    document.querySelectorAll("a[href*='twitter.com'], a[href*='x.com'], a[href$='.mp4'], a[href$='.jpg']").forEach(addPreviewIfTweetOrMedia);
    MESSAGE_PROCESSOR.addTap($msg => {
        if (tweetPreviewActive) $msg.find("a").each((_, el) => addPreviewIfTweetOrMedia(el));
    });
})();