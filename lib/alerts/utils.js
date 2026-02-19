(function() {
  'use strict';

  function dedupeList(values) {
    const unique = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const text = String(value || '').trim();
      if (!text) {
        return;
      }
      const key = text.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(text);
    });
    return unique;
  }

  function parseStringArray(value, fallback) {
    if (Array.isArray(value)) {
      return dedupeList(value);
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? dedupeList(parsed) : dedupeList(fallback);
      } catch (err) {
        return dedupeList(fallback);
      }
    }
    return dedupeList(fallback);
  }

  function parseListInput(raw) {
    return dedupeList(String(raw || '').split(/[\n,]/g).map((value) => value.trim()));
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  window.CytubeAlertsUtils = Object.freeze({
    dedupeList,
    parseStringArray,
    parseListInput,
    escapeRegExp
  });
})();
