(function() {
  'use strict';

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function simpleHash(text) {
    let hash = 0;
    const source = String(text || '');
    for (let i = 0; i < source.length; i += 1) {
      hash = ((hash << 5) - hash) + source.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function extractPollClockToken(text) {
    const match = String(text || '').match(/([01]?\d|2[0-3]):[0-5]\d:[0-5]\d/);
    return match ? match[0] : '';
  }

  function normalizeTitleForHash(text) {
    const prepared = String(text || '')
      .replace(/\b([01]?\d|2[0-3]):[0-5]\d:[0-5]\d\b/g, ' ')
      .replace(/\bend\s*poll\b/gi, ' ')
      .replace(/\bpoll\b/gi, ' ')
      .replace(/\d+/g, ' ');
    return normalizeText(prepared);
  }

  function titleCase(text) {
    return String(text || '')
      .split(' ')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  window.CytubePollHistoryAnalyzerTextUtils = Object.freeze({
    normalizeText,
    simpleHash,
    extractPollClockToken,
    normalizeTitleForHash,
    titleCase
  });
})();
