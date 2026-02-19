(function() {
  'use strict';

  function create(deps) {
    const options = deps && typeof deps === 'object' ? deps : {};
    const normalizeText = typeof options.normalizeText === 'function' ? options.normalizeText : (value) => String(value || '').trim().toLowerCase();
    const getWinnerRaw = typeof options.getWinnerRaw === 'function' ? options.getWinnerRaw : () => '';
    const resolveWinnerGroupForDatabase = typeof options.resolveWinnerGroupForDatabase === 'function'
      ? options.resolveWinnerGroupForDatabase
      : (winnerRaw) => ({ key: normalizeText(winnerRaw), label: 'Unknown', canonicalKey: '', known: false });
    const parseAliasRuleEntries = typeof options.parseAliasRuleEntries === 'function' ? options.parseAliasRuleEntries : () => new Map();
    const serializeAliasRuleEntries = typeof options.serializeAliasRuleEntries === 'function' ? options.serializeAliasRuleEntries : () => '';
    const maxAliasRulesLength = Number.isFinite(Number(options.maxAliasRulesLength)) ? Number(options.maxAliasRulesLength) : 8000;

    function buildWinnerDatabase(records, aliasRulesText) {
      const groups = new Map();
      (Array.isArray(records) ? records : []).forEach((record) => {
        const winnerRaw = getWinnerRaw(record);
        if (!winnerRaw) {
          return;
        }

        const winnerRawKey = normalizeText(winnerRaw);
        if (!winnerRawKey) {
          return;
        }

        const resolved = resolveWinnerGroupForDatabase(winnerRaw);
        const groupKey = resolved.key;
        let group = groups.get(groupKey);
        if (!group) {
          group = {
            key: groupKey,
            label: resolved.label,
            canonicalKey: resolved.canonicalKey,
            known: resolved.known,
            count: 0,
            rawWinnerKeys: new Set(),
            rawWinners: new Set(),
            polls: []
          };
          groups.set(groupKey, group);
        }

        group.count += 1;
        group.rawWinnerKeys.add(winnerRawKey);
        group.rawWinners.add(winnerRaw);
        group.polls.push({
          id: record.id,
          createdAt: record.createdAt,
          title: record.title,
          source: record.source,
          winnerMode: record.winnerMode,
          winnerRaw,
          options: Array.isArray(record.options) ? record.options.map((option) => option.rawLabel) : []
        });
      });

      // Ensure canonical names from Advanced Rules appear even when they have no polls yet.
      const aliasEntries = parseAliasRuleEntries(aliasRulesText);
      aliasEntries.forEach((aliasEntry, canonicalKey) => {
        if (!canonicalKey) {
          return;
        }
        const canonicalDisplay = String(aliasEntry.canonicalDisplay || '').replace(/\s+/g, ' ').trim();
        if (!canonicalDisplay) {
          return;
        }
        if (groups.has(canonicalKey)) {
          const existing = groups.get(canonicalKey);
          if (existing) {
            existing.label = canonicalDisplay;
            existing.canonicalKey = canonicalKey;
            existing.known = true;
          }
          return;
        }
        groups.set(canonicalKey, {
          key: canonicalKey,
          label: canonicalDisplay,
          canonicalKey,
          known: true,
          count: 0,
          rawWinnerKeys: new Set(),
          rawWinners: new Set(),
          polls: []
        });
      });

      return Array.from(groups.values())
        .map((entry) => ({
          ...entry,
          rawWinnerKeys: Array.from(entry.rawWinnerKeys.values()).sort(),
          rawWinners: Array.from(entry.rawWinners.values()).sort((a, b) => a.localeCompare(b)),
          polls: entry.polls.sort((a, b) => b.createdAt - a.createdAt)
        }))
        .sort((a, b) => {
          if (b.count !== a.count) {
            return b.count - a.count;
          }
          return a.label.localeCompare(b.label);
        });
    }

    function buildAliasInputValueForEntry(entry, aliasEntries) {
      const aliasMap = new Map();
      const entryKey = normalizeText((entry && (entry.canonicalKey || entry.label)) || '');

      const addAlias = (value) => {
        const aliasDisplay = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const aliasKey = normalizeText(aliasDisplay);
        if (!aliasKey || aliasKey === entryKey) {
          return;
        }
        aliasMap.set(aliasKey, aliasDisplay);
      };

      const entryMap = aliasEntries instanceof Map ? aliasEntries : new Map();
      const aliasEntry = entryMap.get(entryKey);
      if (aliasEntry && aliasEntry.aliases instanceof Map) {
        aliasEntry.aliases.forEach((aliasDisplay) => addAlias(aliasDisplay));
      }
      return Array.from(aliasMap.values()).join(', ');
    }

    function applyWinnerGroupAliases(params) {
      const input = params && typeof params === 'object' ? params : {};
      const entry = input.entry;
      if (!entry || !Array.isArray(entry.rawWinnerKeys)) {
        return null;
      }

      const mainName = String(input.nextMainName || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const targetKey = normalizeText(mainName);
      if (!targetKey) {
        return null;
      }

      const aliasEntries = parseAliasRuleEntries(input.aliasRulesText);
      let targetEntry = aliasEntries.get(targetKey);
      if (!targetEntry) {
        targetEntry = { key: targetKey, canonicalDisplay: mainName, aliases: new Map() };
        aliasEntries.set(targetKey, targetEntry);
      } else {
        targetEntry.canonicalDisplay = mainName;
      }

      const aliasCandidates = new Map();
      const addCandidate = (value) => {
        const aliasDisplay = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const aliasKey = normalizeText(aliasDisplay);
        if (!aliasKey) {
          return;
        }
        aliasCandidates.set(aliasKey, aliasDisplay);
      };
      addCandidate(mainName);
      String(input.aliasCsv || '')
        .split(',')
        .map((part) => part.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .forEach((aliasRaw) => addCandidate(aliasRaw));

      aliasEntries.forEach((aliasEntry) => {
        aliasCandidates.forEach((_, aliasKey) => {
          aliasEntry.aliases.delete(aliasKey);
        });
      });
      aliasCandidates.forEach((aliasDisplay, aliasKey) => {
        if (aliasKey === targetKey) {
          return;
        }
        targetEntry.aliases.set(aliasKey, aliasDisplay);
      });

      const nextWinnerOverrides = input.winnerOverrides && typeof input.winnerOverrides === 'object'
        ? { ...input.winnerOverrides }
        : {};

      entry.rawWinnerKeys.forEach((rawKey) => {
        const key = normalizeText(rawKey);
        if (!key) {
          return;
        }
        nextWinnerOverrides[key] = mainName;
      });

      return {
        aliasRulesText: serializeAliasRuleEntries(aliasEntries).slice(0, maxAliasRulesLength),
        winnerOverrides: nextWinnerOverrides
      };
    }

    function resetWinnerGroupAliasesData(params) {
      const input = params && typeof params === 'object' ? params : {};
      const entry = input.entry;
      if (!entry || !Array.isArray(entry.rawWinnerKeys)) {
        return null;
      }

      const nextWinnerOverrides = input.winnerOverrides && typeof input.winnerOverrides === 'object'
        ? { ...input.winnerOverrides }
        : {};

      const rawKeySet = new Set(
        entry.rawWinnerKeys
          .map((rawKey) => normalizeText(rawKey))
          .filter(Boolean)
      );
      rawKeySet.forEach((key) => {
        delete nextWinnerOverrides[key];
      });

      const aliasEntries = parseAliasRuleEntries(input.aliasRulesText);
      Array.from(aliasEntries.keys()).forEach((canonicalKey) => {
        const aliasEntry = aliasEntries.get(canonicalKey);
        if (!aliasEntry) {
          return;
        }
        rawKeySet.forEach((rawKey) => {
          aliasEntry.aliases.delete(rawKey);
        });
        if (rawKeySet.has(canonicalKey) && aliasEntry.aliases.size === 0) {
          aliasEntries.delete(canonicalKey);
        }
      });

      return {
        aliasRulesText: serializeAliasRuleEntries(aliasEntries).slice(0, maxAliasRulesLength),
        winnerOverrides: nextWinnerOverrides
      };
    }

    return {
      buildWinnerDatabase,
      buildAliasInputValueForEntry,
      applyWinnerGroupAliases,
      resetWinnerGroupAliasesData
    };
  }

  window.CytubePollHistoryAnalyzerWinnerDatabase = Object.freeze({
    create
  });
})();
