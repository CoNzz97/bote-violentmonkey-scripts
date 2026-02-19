(function() {
  'use strict';

  const EMOTE_PLACEHOLDER_SRC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNjY2NjY2Ij48cGF0aCBkPSJNMCAwaDI0djI0SDBWMHoiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMTkgM0g1Yy0xLjEgMC0yIC45LTIgMnYxNGMwIDEuMS45IDIgMiAyaDE0YzEuMSAwIDItLjkgMi0yVjVjMC0xLjEtLjktMi0yLTJ6bS0uMjkgMTUuNDdsLTUuODMtNS44M0w5Ljg4IDE2Ljc2IDYuNyAxMy41OCA1LjI5IDE1bDQuNTkgNC41OSA4LjQ3LTguNDcgMS40MiAxLjQxTDE4LjcxIDE4LjQ3eiIvPjwvc3ZnPg==';

  function safeGMOperation(operation, defaultValue, loggerPrefix = '[Cytube Logger]') {
    try {
      return operation();
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error(`${loggerPrefix} Storage error:`, err);
      }
      return defaultValue;
    }
  }

  function getUKTimestamp() {
    const now = new Date();
    const options = { timeZone: 'Europe/London', hour12: false };
    const time = now.toLocaleTimeString('en-GB', options).split(':');
    return `[${time[0].padStart(2, '0')}:${time[1]}:${time[2].split(' ')[0].padStart(2, '0')}]`;
  }

  function getFormattedDate(date) {
    const dateObj = date instanceof Date ? date : new Date(date || Date.now());
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${d}_${m}_${y}`;
  }

  function toPositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  function sanitizeDisplayLimits(candidate, defaults) {
    const safeDefaults = {
      globalStats: toPositiveInt(defaults && defaults.globalStats, 2000),
      userStats: toPositiveInt(defaults && defaults.userStats, 100),
      topEmotesPerUser: toPositiveInt(defaults && defaults.topEmotesPerUser, 10),
      previewMessages: toPositiveInt(defaults && defaults.previewMessages, 250)
    };
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      globalStats: toPositiveInt(source.globalStats, safeDefaults.globalStats),
      userStats: toPositiveInt(source.userStats, safeDefaults.userStats),
      topEmotesPerUser: toPositiveInt(source.topEmotesPerUser, safeDefaults.topEmotesPerUser),
      previewMessages: toPositiveInt(source.previewMessages, safeDefaults.previewMessages)
    };
  }

  function parseDisplayLimits(rawValue, defaults) {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return sanitizeDisplayLimits(rawValue, defaults);
    }
    if (typeof rawValue === 'string') {
      try {
        const parsed = JSON.parse(rawValue);
        return sanitizeDisplayLimits(parsed, defaults);
      } catch (err) {
        return sanitizeDisplayLimits({}, defaults);
      }
    }
    return sanitizeDisplayLimits({}, defaults);
  }

  window.CytubeEmoteGlobalTrackerUtils = Object.freeze({
    EMOTE_PLACEHOLDER_SRC,
    safeGMOperation,
    getUKTimestamp,
    getFormattedDate,
    sanitizeDisplayLimits,
    parseDisplayLimits
  });
})();
