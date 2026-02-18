(function() {
  'use strict';

  function safeGetValue(key, fallback) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function safeSetValue(key, value) {
    try {
      GM_setValue(key, value);
    } catch (err) {
      // Keep script stable on storage failures.
    }
  }

  function parseStoredObject(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err) {
        return {};
      }
    }
    return {};
  }

  function parseStoredArray(raw) {
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    return [];
  }

  function parseWinnerOverrides(raw, normalizeTextFn) {
    const base = parseStoredObject(raw);
    const clean = {};
    if (typeof normalizeTextFn !== 'function') {
      return clean;
    }

    Object.keys(base).forEach((key) => {
      const rawKey = normalizeTextFn(key);
      const label = String(base[key] || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!rawKey || !label) {
        return;
      }
      clean[rawKey] = label;
    });

    return clean;
  }

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

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  function sanitizeWinnerFilter(value) {
    if (value === 'official' || value === 'soft' || value === 'none') {
      return value;
    }
    return 'all';
  }

  function sanitizeViewMode(value) {
    return value === 'raw' ? 'raw' : 'grouped';
  }

  window.CytubePollHistoryAnalyzerStorageUtils = Object.freeze({
    safeGetValue,
    safeSetValue,
    parseStoredObject,
    parseStoredArray,
    parseWinnerOverrides,
    parseBoolean,
    clampNumber,
    sanitizeWinnerFilter,
    sanitizeViewMode
  });
})();
