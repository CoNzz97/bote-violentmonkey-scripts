// ==UserScript==
// @name         migobote auto poll
// @namespace    http://tampermonkey.net/
// @version      2025.8
// @description  Automatically fetches streams from holodex and presents a popup with valid streams to poll
// @author       You
// @match        https://om3tcw.com/r/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    let API_KEY = GM_getValue('holodex_api_key');

    function checkApiKey() {
        if (API_KEY) return true;
        const key = prompt('Please enter your Holodex API Key:\n(Found in Settings -> API Key on holodex.net)');
        if (key && key.trim()) {
            GM_setValue('holodex_api_key', key.trim());
            API_KEY = key.trim();
            return true;
        }
        alert('No API key — cannot fetch.');
        return false;
    }

    const AP_TOPIC_FIRST = false;

    let includeMales = false;

    function isHololiveFemale(channel) {
        if (!channel) return false;
        const org = (channel.org || '').toLowerCase();
        const suborg = (channel.suborg || '').toLowerCase();
        const name = (channel.name || '').toLowerCase();
        const enName = (channel.english_name || '').toLowerCase();
        if (org.includes('holostars') || suborg.includes('holostars') ||
            name.includes('holostars') || enName.includes('holostars')) return false;
        return org.includes('hololive') || suborg.includes('hololive') ||
               name.includes('hololive') || enName.includes('hololive');
    }

    function fetchStreams(callback) {
        if (!checkApiKey()) return callback([]);
        GM.xmlHttpRequest({
            method: "GET",
            url: "https://holodex.net/api/v2/live?type=placeholder,stream&include=mentions&org=Hololive&sort=available_at",
            headers: {
                "X-APIKEY": API_KEY,
                "Referer": "https://holodex.net/"
            },
            onload: res => {
                if (res.status !== 200) return callback([]);
                try { callback(JSON.parse(res.responseText)); }
                catch (_) { callback([]); }
            },
            onerror: () => callback([])
        });
    }

    function streamIsLiveOrAboutToStart(stream) {
        var seconds_until = (new Date(stream.available_at) - new Date()) / 1000;
        let is_valid_live = stream.status === "live"
            && !(Math.abs(seconds_until) > 1800 && stream.live_viewers < 100);
        let is_about_to_start = Math.abs(seconds_until) < 600;
        return is_valid_live || is_about_to_start;
    }

    function makePoll() {
        fetchStreams(streams => {
            if (!streams || !streams.length) return;

            const duplicateNames = new Set();
            const seenNames = new Set();

            streams.forEach(stream => {
                const name = stream.channel.english_name;
                if (!name) return;
                if (seenNames.has(name) && stream.status === "live"
                    && stream.topic_id !== "membersonly"
                    && stream.topic_id !== "membership"
                    && stream.topic_id !== "Original_Song"
                    && stream.topic_id !== "Music_Cover") {
                    duplicateNames.add(name);
                } else {
                    seenNames.add(name);
                }
            });

            streams.filter(stream => {
                return (stream.type === "stream" ||
                        (stream.type === "placeholder" && stream.link.includes("twitch.tv") && !duplicateNames.has(stream.channel.english_name)))
                    && stream.topic_id !== "membersonly"
                    && stream.topic_id !== "membership"
                    && stream.topic_id !== "Original_Song"
                    && stream.topic_id !== "Music_Cover"
                    && stream.topic_id !== "watchalong"
                    && stream.channel.org === "Hololive"
                    && (includeMales || isHololiveFemale(stream.channel))
                    && streamIsLiveOrAboutToStart(stream);
            }).sort((a, b) => new Date(a.available_at) - new Date(b.available_at))
            .forEach(stream => {
                var topic = stream.topic_id ? ` - ${stream.topic_id}`.replaceAll('_', ' ') : getTopicFromTitle(stream.title);
                var result = stream.channel.english_name + topic.replaceAll('_', ' ');
                if (AP_TOPIC_FIRST) result = topic.replaceAll('_', ' ') + stream.channel.english_name;

                result += checkIfRebroadCast(stream.title);
                if (stream.type === "placeholder" && stream.link.includes("twitch.tv")) result += " - Twitch";

                if (stream.status !== "live") {
                    var minutes_until = Math.floor((new Date(stream.available_at) - new Date()) / 1000 / 60);
                    result += ` (in ${minutes_until} minutes)`;
                }

                $("<input/>").addClass("form-control poll-menu-option")
                    .attr("type", "text")
                    .attr("maxlength", "255")
                    .val(result)
                    .insertBefore($('button:contains("Add Option")'));
            });

            $("<input/>").addClass("form-control poll-menu-option")
                .attr("type", "text")
                .attr("maxlength", "255")
                .val("Playlist")
                .insertBefore($('button:contains("Add Option")'));
        });
    }

    function getTopicFromTitle(title) {
        const match = title.match(/\s*(?:【|\[)(.+?)(?:】|\])\s*/);
        if (match && match[1]) return ' - ' + match[1].trim();
        return '';
    }

    function checkIfRebroadCast(title) {
        if (/rebroadcast/i.test(title)) return ' (Rebroadcast)';
        if (/pre-?recorded/i.test(title)) return ' (Pre-recorded)';
        return '';
    }

    // Original button injection
    (function() {
        const newpollbtn = document.querySelector("#newpollbtn");
        if (!newpollbtn) return;

        newpollbtn.addEventListener("click", () => {
            setTimeout(() => {
                // Original fetch button placement
                let update_btn = document.createElement("button");
                update_btn.classList.add("btn", "btn-success", "pull-left");
                update_btn.innerText = "Fetch streams";
                update_btn.addEventListener("click", makePoll);

                const pollwrap = document.querySelector("#pollwrap");
                if (pollwrap && pollwrap.firstChild) {
                    pollwrap.firstChild.insertBefore(update_btn, pollwrap.firstChild.children[1]);
                }

                // Toggle insertion next to other toggles
                const hideLabel = $('label:contains("Hide poll results until it closes")');
                let toggleParent = hideLabel.length ? hideLabel : $('label:contains("Keep poll vote after user leaves")');

                const toggleLabel = $('<label style="display: block; margin: 8px 0;"><input type="checkbox"> Include males (Holostars)</label>');
                toggleLabel.find('input').prop('checked', includeMales);
                toggleLabel.find('input').on('change', function() {
                    includeMales = this.checked;
                });

                if (toggleParent.length) {
                    toggleParent.after(toggleLabel);
                } else {
                    // Ultimate fallback near Add Option
                    $('button:contains("Add Option")').parent().prepend(toggleLabel);
                }

                // Cleanup on Cancel
                $('button:contains("Cancel")').on('click', function() {
                    update_btn.remove();
                    toggleLabel.remove();
                    $('.poll-menu-option').remove();  // clear added options
                });

            }, 500);  // delay for modal to fully render toggles
        });
    })();

})();