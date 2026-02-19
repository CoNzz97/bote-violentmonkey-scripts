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

  function normalizeUsername(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
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

  function sanitizeFilter(value) {
    if (value === 'join' || value === 'leave') {
      return value;
    }
    return 'all';
  }

  function formatTimestamp(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (err) {
      return '';
    }
  }

  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const type = raw.type === 'join' || raw.type === 'leave' ? raw.type : '';
    if (!type) {
      return null;
    }

    const username = String(raw.username || '').replace(/\s+/g, ' ').trim();
    const userKey = normalizeUsername(raw.userKey || username);
    if (!username || !userKey) {
      return null;
    }

    const ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts <= 0) {
      return null;
    }

    const role = String(raw.role || 'user').replace(/\s+/g, ' ').trim() || 'user';
    const id = String(raw.id || `${ts}-${type}-${userKey}`);
    const timeLabel = String(raw.timeLabel || formatTimestamp(ts));

    return { id, ts, timeLabel, type, username, userKey, role };
  }

  function getRoleLabel(row, nameSpan) {
    const classText = `${row.className || ''} ${nameSpan ? nameSpan.className : ''}`;
    const labels = [];

    if (/\buserlist_owner\b/i.test(classText)) {
      labels.push('owner');
    } else if (/\buserlist_admin\b/i.test(classText)) {
      labels.push('admin');
    } else if (/\buserlist_op\b/i.test(classText)) {
      labels.push('op');
    } else if (/\buserlist_guest\b/i.test(classText)) {
      labels.push('guest');
    }

    if (/\buserlist_afk\b/i.test(classText)) {
      labels.push('afk');
    }

    return labels.length ? labels.join(', ') : 'user';
  }

  function extractUserInfoFromRow(row) {
    if (!(row instanceof HTMLElement)) {
      return null;
    }

    const spans = Array.from(row.children).filter((node) => node instanceof HTMLSpanElement);
    let nameSpan = spans.find((span) => {
      const classText = span.className || '';
      return /\buserlist_(owner|admin|op|guest)\b/i.test(classText);
    }) || null;

    if (!nameSpan) {
      nameSpan = spans.find((span) => {
        if (span.querySelector('.glyphicon-time')) {
          return false;
        }
        const text = span.textContent.replace(/\s+/g, ' ').trim();
        return Boolean(text);
      }) || null;
    }

    let username = nameSpan ? nameSpan.textContent.replace(/\s+/g, ' ').trim() : '';
    if (!username && row.id && row.id.startsWith('useritem-')) {
      username = row.id.slice('useritem-'.length).trim();
    }

    const userKey = normalizeUsername(username);
    if (!userKey) {
      return null;
    }

    return {
      username,
      userKey,
      role: getRoleLabel(row, nameSpan)
    };
  }

  function snapshotUserMap() {
    const map = new Map();
    document.querySelectorAll('#userlist .userlist_item').forEach((row) => {
      const info = extractUserInfoFromRow(row);
      if (!info || map.has(info.userKey)) {
        return;
      }
      map.set(info.userKey, info);
    });
    return map;
  }

  function diffPresenceMaps(previousMap, nextMap) {
    const events = [];

    nextMap.forEach((info, userKey) => {
      if (!previousMap.has(userKey)) {
        events.push({ type: 'join', ...info });
      }
    });

    previousMap.forEach((info, userKey) => {
      if (!nextMap.has(userKey)) {
        events.push({ type: 'leave', ...info });
      }
    });

    return events;
  }

  function nodeIsUserRow(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    if (node.classList.contains('userlist_item')) {
      return true;
    }
    if (node.id && node.id.startsWith('useritem-')) {
      return true;
    }
    return false;
  }

  function mutationAffectsRoster(mutation) {
    if (!mutation || mutation.type !== 'childList') {
      return false;
    }

    for (const node of mutation.addedNodes) {
      if (nodeIsUserRow(node)) {
        return true;
      }
    }

    for (const node of mutation.removedNodes) {
      if (nodeIsUserRow(node)) {
        return true;
      }
    }

    const target = mutation.target instanceof HTMLElement ? mutation.target : null;
    return Boolean(target && target.id === 'userlist' && (mutation.addedNodes.length || mutation.removedNodes.length));
  }

  function getCounts(entries) {
    let joins = 0;
    let leaves = 0;
    entries.forEach((entry) => {
      if (entry.type === 'join') {
        joins += 1;
      } else if (entry.type === 'leave') {
        leaves += 1;
      }
    });
    return { joins, leaves, net: joins - leaves };
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

  window.CytubeConnectionLogUtils = Object.freeze({
    parseStoredObject,
    parseStoredArray,
    normalizeUsername,
    clampNumber,
    parseBoolean,
    sanitizeFilter,
    formatTimestamp,
    sanitizeEntry,
    getRoleLabel,
    extractUserInfoFromRow,
    snapshotUserMap,
    diffPresenceMaps,
    nodeIsUserRow,
    mutationAffectsRoster,
    getCounts,
    extractConnectedUsersFromElement
  });
})();
