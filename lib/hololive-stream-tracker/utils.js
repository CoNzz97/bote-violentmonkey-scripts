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

  function buildKeywordRegexes(keywords) {
    return (Array.isArray(keywords) ? keywords : [])
      .map((kw) => String(kw || '').trim())
      .filter(Boolean)
      .map((kw) => new RegExp(kw.replace(/[-_\s]+/g, '[-_\\s]+'), 'i'));
  }

  function isHololive(channel, allowHolostars = false) {
    if (!channel || typeof channel !== 'object') {
      return false;
    }
    const name = String(channel.name || '').toLowerCase();
    const enName = String(channel.english_name || '').toLowerCase();
    const org = String(channel.org || '').toLowerCase();
    const suborg = String(channel.suborg || '').toLowerCase();
    const combined = `${name}${enName}${org}${suborg}`;

    const isHolostars = /holostars/i.test(combined) || /ホロスターズ/i.test(name);
    if (isHolostars && !allowHolostars) {
      return false;
    }

    return (
      org.includes('hololive') || suborg.includes('hololive') ||
      name.includes('hololive') || enName.includes('hololive') ||
      /hololive[-_\s]*(en|id|jp|english|indonesia|justice)/i.test(combined)
    );
  }

  function formatUKDate(dateString) {
    const d = new Date(dateString);
    if (!Number.isFinite(d.getTime())) {
      return '';
    }
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatTimeUntil(video) {
    const isLive = Boolean(video && (video.status === 'live' || video.start_actual));
    const now = new Date();

    if (isLive) {
      const start = new Date((video && (video.start_actual || video.start_scheduled || video.available_at)) || now);
      const diffMs = Math.max(0, now - start);
      const totalMinutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `[${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}]`;
    }

    const target = new Date(video && (video.start_scheduled || video.available_at));
    let diffMs = target - now;
    if (!Number.isFinite(diffMs)) {
      return '[past]';
    }
    if (diffMs < 0) {
      return '[past]';
    }

    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const parts = [];
    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (days > 0 || hours > 0) {
      parts.push(`${hours}h`);
    }
    parts.push(`${minutes.toString().padStart(2, '0')}m`);
    return `[${parts.join(' ')}]`;
  }

  function getStreamTag(video, keywords, keywordRegexes, tagMap) {
    const title = String(video && video.title || '');
    const topicId = String(video && video.topic_id || '');
    const description = String(video && video.description || '');
    const safeKeywords = Array.isArray(keywords) ? keywords : [];
    const safeRegexes = Array.isArray(keywordRegexes) ? keywordRegexes : [];
    const safeTagMap = tagMap && typeof tagMap === 'object' ? tagMap : {};

    for (let i = 0; i < safeKeywords.length; i += 1) {
      const keyword = safeKeywords[i];
      const rx = safeRegexes[i];
      if (!(rx instanceof RegExp)) {
        continue;
      }
      if (rx.test(title) || rx.test(topicId) || rx.test(description)) {
        return safeTagMap[keyword] || keyword;
      }
    }
    return (video && video.type === 'premiere') ? 'Premiere' : '';
  }

  window.CytubeHololiveStreamTrackerUtils = Object.freeze({
    parseBoolean,
    buildKeywordRegexes,
    isHololive,
    formatUKDate,
    formatTimeUntil,
    getStreamTag
  });
})();
