(function() {
  'use strict';

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

  function extractConnectedUsersFromElement(userCountEl) {
    if (!(userCountEl instanceof HTMLElement)) {
      return null;
    }

    const clone = userCountEl.cloneNode(true);
    if (clone instanceof HTMLElement) {
      clone.querySelectorAll('.profile-box').forEach((node) => node.remove());
    }

    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    if (!text) {
      return null;
    }

    const connectedMatch = text.match(/(\d+)\s*(?:connected\s*users?|users?\s*connected)/i);
    if (connectedMatch) {
      return Number(connectedMatch[1]);
    }

    const firstNumberMatch = text.match(/(\d+)/);
    return firstNumberMatch ? Number(firstNumberMatch[1]) : null;
  }

  function computeStats(samples) {
    if (!Array.isArray(samples) || !samples.length) {
      return null;
    }

    let min = samples[0].count;
    let max = samples[0].count;
    let sum = 0;
    samples.forEach((sample) => {
      if (sample.count < min) {
        min = sample.count;
      }
      if (sample.count > max) {
        max = sample.count;
      }
      sum += sample.count;
    });

    const current = samples[samples.length - 1].count;
    const previous = samples.length > 1 ? samples[samples.length - 2].count : current;
    const average = sum / samples.length;

    return {
      current,
      min,
      max,
      average,
      deltaPrev: current - previous,
      deltaAvg: current - average
    };
  }

  function formatSigned(value) {
    const rounded = Math.round(Number(value) * 100) / 100;
    return rounded >= 0 ? `+${rounded}` : `${rounded}`;
  }

  window.CytubeUsercountTrendUtils = Object.freeze({
    parseStoredObject,
    parseStoredArray,
    parseBoolean,
    clampNumber,
    extractConnectedUsersFromElement,
    computeStats,
    formatSigned
  });
})();
