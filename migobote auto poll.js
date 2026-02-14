// ==UserScript==
// @name         migobote auto poll
// @namespace    http://tampermonkey.net/
// @version      2026.3
// @description  Automatically fetches streams from holodex and presents a popup with valid streams to poll
// @author       You
// @match        https://om3tcw.com/r/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  'use strict';

  const API_URL = 'https://holodex.net/api/v2/live?type=placeholder,stream&include=mentions&org=Hololive&sort=available_at';
  const AP_TOPIC_FIRST = false;
  const EXCLUDED_TOPICS = new Set(['membersonly', 'membership', 'Original_Song', 'Music_Cover', 'watchalong']);
  const ADDED_OPTION_SELECTOR = '.poll-menu-option[data-autopoll-added="1"]';
  const INCLUDE_MALES_KEY = 'holodex_include_males';

  let API_KEY = GM_getValue('holodex_api_key');
  let includeMales = Boolean(GM_getValue(INCLUDE_MALES_KEY, false));

  function checkApiKey() {
    if (API_KEY) {
      return true;
    }

    const key = prompt('Please enter your Holodex API Key:\n(Found in Settings -> API Key on holodex.net)');
    if (key && key.trim()) {
      API_KEY = key.trim();
      GM_setValue('holodex_api_key', API_KEY);
      return true;
    }

    alert('No API key — cannot fetch.');
    return false;
  }

  function isExcludedTopic(topicId) {
    return EXCLUDED_TOPICS.has(topicId || '');
  }

  function isHololiveFemale(channel) {
    if (!channel) {
      return false;
    }

    const org = (channel.org || '').toLowerCase();
    const suborg = (channel.suborg || '').toLowerCase();
    const name = (channel.name || '').toLowerCase();
    const enName = (channel.english_name || '').toLowerCase();

    const isHolostars = org.includes('holostars') || suborg.includes('holostars') || name.includes('holostars') || enName.includes('holostars');
    if (isHolostars) {
      return false;
    }

    return org.includes('hololive') || suborg.includes('hololive') || name.includes('hololive') || enName.includes('hololive');
  }

  function streamIsLiveOrAboutToStart(stream) {
    const secondsUntil = (new Date(stream.available_at) - new Date()) / 1000;
    const isValidLive = stream.status === 'live' && !(Math.abs(secondsUntil) > 1800 && stream.live_viewers < 100);
    const isAboutToStart = Math.abs(secondsUntil) < 600;
    return isValidLive || isAboutToStart;
  }

  function fetchStreams(callback) {
    if (!checkApiKey()) {
      callback([]);
      return;
    }

    GM.xmlHttpRequest({
      method: 'GET',
      url: API_URL,
      headers: {
        'X-APIKEY': API_KEY,
        Referer: 'https://holodex.net/'
      },
      onload: (res) => {
        if (res.status !== 200) {
          callback([]);
          return;
        }

        try {
          callback(JSON.parse(res.responseText));
        } catch (err) {
          callback([]);
        }
      },
      onerror: () => callback([])
    });
  }

  function getTopicFromTitle(title) {
    const match = title.match(/\s*(?:【|\[)(.+?)(?:】|\])\s*/);
    return match && match[1] ? ` - ${match[1].trim()}` : '';
  }

  function checkIfRebroadCast(title) {
    if (/rebroadcast/i.test(title)) {
      return ' (Rebroadcast)';
    }
    if (/pre-?recorded/i.test(title)) {
      return ' (Pre-recorded)';
    }
    return '';
  }

  function getPollMenu() {
    return document.querySelector('#pollwrap .poll-menu');
  }

  function getAddOptionButton(pollMenu) {
    return pollMenu ? Array.from(pollMenu.querySelectorAll('button')).find((btn) => btn.textContent.trim() === 'Add Option') : null;
  }

  function clearAddedOptions(pollMenu) {
    if (!pollMenu) {
      return;
    }
    pollMenu.querySelectorAll(ADDED_OPTION_SELECTOR).forEach((node) => node.remove());
  }

  function insertPollOption(pollMenu, value) {
    const addOptionButton = getAddOptionButton(pollMenu);
    if (!pollMenu || !addOptionButton) {
      return;
    }

    const input = document.createElement('input');
    input.className = 'form-control poll-menu-option';
    input.type = 'text';
    input.maxLength = 255;
    input.value = value;
    input.dataset.autopollAdded = '1';
    pollMenu.insertBefore(input, addOptionButton);
  }

  function buildPollOptionText(stream) {
    const topic = stream.topic_id ? ` - ${stream.topic_id}`.replaceAll('_', ' ') : getTopicFromTitle(stream.title);
    const streamName = stream.channel.english_name || stream.channel.name || 'Unknown';
    let result = AP_TOPIC_FIRST ? `${topic.replaceAll('_', ' ')}${streamName}` : `${streamName}${topic.replaceAll('_', ' ')}`;

    result += checkIfRebroadCast(stream.title || '');
    if (stream.type === 'placeholder' && (stream.link || '').includes('twitch.tv')) {
      result += ' - Twitch';
    }

    if (stream.status !== 'live') {
      const minutesUntil = Math.floor((new Date(stream.available_at) - new Date()) / 1000 / 60);
      result += ` (in ${minutesUntil} minutes)`;
    }

    return result;
  }

  function makePoll(pollMenu) {
    fetchStreams((streams) => {
      if (!streams || !streams.length) {
        return;
      }

      clearAddedOptions(pollMenu);

      const duplicateNames = new Set();
      const seenNames = new Set();

      streams.forEach((stream) => {
        const channel = stream.channel || {};
        const name = channel.english_name;
        if (!name) {
          return;
        }

        if (seenNames.has(name) && stream.status === 'live' && !isExcludedTopic(stream.topic_id)) {
          duplicateNames.add(name);
        } else {
          seenNames.add(name);
        }
      });

      streams
        .filter((stream) => {
          const channel = stream.channel || {};
          const channelName = channel.english_name;
          const isStream = stream.type === 'stream';
          const isValidTwitchPlaceholder = stream.type === 'placeholder' && (stream.link || '').includes('twitch.tv') && !duplicateNames.has(channelName);

          return (
            (isStream || isValidTwitchPlaceholder) &&
            !isExcludedTopic(stream.topic_id) &&
            channel.org === 'Hololive' &&
            (includeMales || isHololiveFemale(channel)) &&
            streamIsLiveOrAboutToStart(stream)
          );
        })
        .sort((a, b) => new Date(a.available_at) - new Date(b.available_at))
        .forEach((stream) => {
          insertPollOption(pollMenu, buildPollOptionText(stream));
        });

      insertPollOption(pollMenu, 'Playlist');
    });
  }

  function injectPollControls() {
    const pollMenu = getPollMenu();
    if (!pollMenu || pollMenu.querySelector('#holodex-fetch-streams-btn')) {
      return;
    }

    const cancelButton = Array.from(pollMenu.querySelectorAll('button')).find((btn) => btn.textContent.trim() === 'Cancel');
    const fetchButton = document.createElement('button');
    fetchButton.id = 'holodex-fetch-streams-btn';
    fetchButton.className = 'btn btn-success pull-left';
    fetchButton.textContent = 'Fetch streams';
    fetchButton.addEventListener('click', () => makePoll(pollMenu));

    const firstStrong = pollMenu.querySelector('strong');
    if (firstStrong) {
      pollMenu.insertBefore(fetchButton, firstStrong);
    } else {
      pollMenu.prepend(fetchButton);
    }

    const toggleLabel = document.createElement('label');
    toggleLabel.id = 'holodex-include-males-toggle';
    toggleLabel.style.display = 'block';
    toggleLabel.style.margin = '8px 0';
    toggleLabel.innerHTML = '<input type="checkbox"> Include males (Holostars)';
    const toggleInput = toggleLabel.querySelector('input');
    toggleInput.checked = includeMales;
    toggleInput.addEventListener('change', function() {
      includeMales = this.checked;
      GM_setValue(INCLUDE_MALES_KEY, includeMales);
    });

    const hideLabel = Array.from(pollMenu.querySelectorAll('label')).find((label) => label.textContent.includes('Hide poll results until it closes'));
    const keepVoteLabel = Array.from(pollMenu.querySelectorAll('label')).find((label) => label.textContent.includes('Keep poll vote after user leaves'));
    const anchorLabel = hideLabel || keepVoteLabel;
    if (anchorLabel) {
      anchorLabel.insertAdjacentElement('afterend', toggleLabel);
    } else {
      const addOptionButton = getAddOptionButton(pollMenu);
      if (addOptionButton) {
        pollMenu.insertBefore(toggleLabel, addOptionButton);
      } else {
        pollMenu.appendChild(toggleLabel);
      }
    }

    if (cancelButton) {
      cancelButton.addEventListener(
        'click',
        () => {
          fetchButton.remove();
          toggleLabel.remove();
          clearAddedOptions(pollMenu);
        },
        { once: true }
      );
    }
  }

  (function init() {
    const newPollButton = document.querySelector('#newpollbtn');
    if (!newPollButton) {
      return;
    }

    newPollButton.addEventListener('click', () => {
      setTimeout(injectPollControls, 500);
    });
  })();

})();
