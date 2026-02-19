(function() {
  'use strict';

  function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
    return fallback;
  }

  function isHololiveFemale(channel) {
    if (!channel || typeof channel !== 'object') {
      return false;
    }

    const org = String(channel.org || '').toLowerCase();
    const suborg = String(channel.suborg || '').toLowerCase();
    const name = String(channel.name || '').toLowerCase();
    const enName = String(channel.english_name || '').toLowerCase();

    const isHolostars = org.includes('holostars')
      || suborg.includes('holostars')
      || name.includes('holostars')
      || enName.includes('holostars');
    if (isHolostars) {
      return false;
    }

    return org.includes('hololive')
      || suborg.includes('hololive')
      || name.includes('hololive')
      || enName.includes('hololive');
  }

  function streamIsLiveOrAboutToStart(stream) {
    const availableAt = new Date(stream && stream.available_at);
    if (!Number.isFinite(availableAt.getTime())) {
      return false;
    }
    const secondsUntil = (availableAt - new Date()) / 1000;
    const liveViewers = Number(stream && stream.live_viewers) || 0;
    const status = String(stream && stream.status || '');

    const isValidLive = status === 'live' && !(Math.abs(secondsUntil) > 1800 && liveViewers < 100);
    const isAboutToStart = Math.abs(secondsUntil) < 600;
    return isValidLive || isAboutToStart;
  }

  function getTopicFromTitle(title) {
    const match = String(title || '').match(/\s*(?:【|\[)(.+?)(?:】|\])\s*/);
    return match && match[1] ? ` - ${match[1].trim()}` : '';
  }

  function checkIfRebroadcast(title) {
    const text = String(title || '');
    if (/rebroadcast/i.test(text)) {
      return ' (Rebroadcast)';
    }
    if (/pre-?recorded/i.test(text)) {
      return ' (Pre-recorded)';
    }
    return '';
  }

  window.CytubeMigoboteAutoPollUtils = Object.freeze({
    parseBoolean,
    isHololiveFemale,
    streamIsLiveOrAboutToStart,
    getTopicFromTitle,
    checkIfRebroadcast
  });
})();
