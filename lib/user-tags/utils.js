(function() {
  'use strict';

  function normalizeUsername(name) {
    return String(name || '').trim().toLowerCase();
  }

  function normalizeColor(color, fallback = '#5bc0de') {
    const text = String(color || '').trim();
    const shortHex = /^#([0-9a-fA-F]{3})$/;
    const longHex = /^#([0-9a-fA-F]{6})$/;
    if (longHex.test(text)) {
      return text.toLowerCase();
    }
    const shortMatch = text.match(shortHex);
    if (shortMatch) {
      const [r, g, b] = shortMatch[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return fallback;
  }

  function sanitizeTags(tags, defaultColor = '#5bc0de') {
    const clean = [];
    const seen = new Set();
    (Array.isArray(tags) ? tags : []).forEach((tag) => {
      const label = String(tag && tag.label || '').trim();
      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      clean.push({
        label,
        color: normalizeColor(tag && tag.color, defaultColor)
      });
    });
    return clean;
  }

  function sanitizeEntry(rawKey, rawEntry, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const defaultColor = String(opts.defaultColor || '#5bc0de');
    const noteMaxLength = Number.isFinite(Number(opts.noteMaxLength)) ? Number(opts.noteMaxLength) : 500;

    const displayName = String(rawEntry && rawEntry.displayName || rawKey || '').trim();
    const normalized = normalizeUsername(displayName || rawKey);
    if (!normalized) {
      return null;
    }
    const tags = sanitizeTags(rawEntry && rawEntry.tags, defaultColor);
    const note = String(rawEntry && rawEntry.note || '').trim().slice(0, noteMaxLength);
    if (!tags.length && !note) {
      return null;
    }
    return {
      key: normalized,
      value: {
        displayName: displayName || rawKey,
        tags,
        note,
        updatedAt: Number(rawEntry && rawEntry.updatedAt) || Date.now()
      }
    };
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

  function parseTagsInput(raw, defaultColor) {
    const tokens = String(raw || '').split(/[\n,]/g);
    const tags = [];
    const seen = new Set();

    tokens.forEach((token) => {
      const trimmed = token.trim();
      if (!trimmed) {
        return;
      }

      let label = trimmed;
      let color = defaultColor;

      const pipeIndex = trimmed.indexOf('|');
      if (pipeIndex > -1) {
        label = trimmed.slice(0, pipeIndex).trim();
        color = normalizeColor(trimmed.slice(pipeIndex + 1).trim(), defaultColor);
      }

      if (!label) {
        return;
      }
      const key = label.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      tags.push({ label, color });
    });

    return tags;
  }

  window.CytubeUserTagsUtils = Object.freeze({
    normalizeUsername,
    normalizeColor,
    sanitizeTags,
    sanitizeEntry,
    parseStoredObject,
    parseTagsInput
  });
})();
