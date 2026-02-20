(function() {
  'use strict';

  function create(deps) {
    const normalizeText = deps && deps.normalizeText;
    const titleCase = deps && deps.titleCase;
    const getRuntimeAliasData = deps && deps.getRuntimeAliasData;
    const getRuntimeSettings = deps && deps.getRuntimeSettings;

    if (typeof normalizeText !== 'function' || typeof titleCase !== 'function') {
      throw new Error('Alias engine requires normalizeText and titleCase dependencies.');
    }

    function parseAliasRules(rawText) {
      const aliasToCanonicalKey = new Map();
      const canonicalKeyToDisplay = new Map();
      const aliases = [];
      const normalizeDisplay = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const toMatchKey = (value) => normalizeText(value).toLowerCase();

      String(rawText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const separatorIdx = line.indexOf(':');
          const hasSeparator = separatorIdx >= 1;
          const canonicalDisplay = normalizeDisplay(hasSeparator ? line.slice(0, separatorIdx) : line);
          if (!canonicalDisplay) {
            return;
          }
          const canonicalKey = toMatchKey(canonicalDisplay);
          if (!canonicalKey) {
            return;
          }
          canonicalKeyToDisplay.set(canonicalKey, canonicalDisplay);

          const aliasList = hasSeparator
            ? line
                .slice(separatorIdx + 1)
                .split(',')
                .map((part) => normalizeDisplay(part))
                .filter(Boolean)
            : [];

          const allAliases = [canonicalDisplay, ...aliasList];
          allAliases.forEach((aliasRaw) => {
            const aliasKey = toMatchKey(aliasRaw);
            if (!aliasKey) {
              return;
            }
            aliasToCanonicalKey.set(aliasKey, canonicalKey);
            aliases.push(aliasKey);
          });
        });

      aliases.sort((a, b) => b.length - a.length);
      return { aliasToCanonicalKey, canonicalKeyToDisplay, orderedAliases: aliases };
    }

    function parseAliasRuleEntries(rawText) {
      const entries = new Map();
      const normalizeDisplay = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const toMatchKey = (value) => normalizeText(value).toLowerCase();
      String(rawText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const separatorIdx = line.indexOf(':');
          const hasSeparator = separatorIdx >= 1;
          const canonicalDisplay = normalizeDisplay(hasSeparator ? line.slice(0, separatorIdx) : line);
          const canonicalKey = toMatchKey(canonicalDisplay);
          if (!canonicalKey) {
            return;
          }

          let entry = entries.get(canonicalKey);
          if (!entry) {
            entry = {
              key: canonicalKey,
              canonicalDisplay,
              aliases: new Map()
            };
            entries.set(canonicalKey, entry);
          } else if (canonicalDisplay) {
            entry.canonicalDisplay = canonicalDisplay;
          }

          if (hasSeparator) {
            line
              .slice(separatorIdx + 1)
              .split(',')
              .map((part) => normalizeDisplay(part))
              .filter(Boolean)
              .forEach((aliasRaw) => {
                const aliasKey = toMatchKey(aliasRaw);
                if (!aliasKey || aliasKey === canonicalKey) {
                  return;
                }
                entry.aliases.set(aliasKey, aliasRaw);
              });
          }
        });

      return entries;
    }

    function serializeAliasRuleEntries(entryMap) {
      const lines = Array.from(entryMap.values())
        .map((entry) => {
          const canonicalDisplay = String(entry.canonicalDisplay || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          const canonicalKey = normalizeText(canonicalDisplay);
          if (!canonicalKey) {
            return null;
          }
          const aliases = Array.from(entry.aliases.entries())
            .filter(([aliasKey, aliasDisplay]) => aliasKey && aliasKey !== canonicalKey && String(aliasDisplay || '').trim())
            .map(([, aliasDisplay]) => String(aliasDisplay).replace(/\s+/g, ' ').trim().slice(0, 120))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
          return aliases.length ? `${canonicalDisplay}: ${aliases.join(', ')}` : `${canonicalDisplay}:`;
        })
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return lines.join('\n');
    }

    function getAliasData() {
      const runtimeAliasData = typeof getRuntimeAliasData === 'function' ? getRuntimeAliasData() : null;
      if (!runtimeAliasData) {
        return null;
      }
      if (!runtimeAliasData.aliasToCanonicalKey || !runtimeAliasData.canonicalKeyToDisplay || !runtimeAliasData.orderedAliases) {
        return null;
      }
      return runtimeAliasData;
    }

    function matchEntity(rawLabel) {
      const aliasData = getAliasData();
      if (!aliasData) {
        return null;
      }

      const normalized = normalizeText(rawLabel);
      if (!normalized) {
        return null;
      }

      for (const alias of aliasData.orderedAliases) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, 'i');
        if (!rx.test(normalized)) {
          continue;
        }
        const canonicalKey = aliasData.aliasToCanonicalKey.get(alias);
        if (!canonicalKey) {
          continue;
        }
        return aliasData.canonicalKeyToDisplay.get(canonicalKey) || titleCase(canonicalKey);
      }

      return null;
    }

    function getGroupedKey(rawLabel) {
      const entity = matchEntity(rawLabel);
      if (entity) {
        return normalizeText(entity);
      }
      return normalizeText(rawLabel);
    }

    function getWinnerOverrideLabel(rawWinner) {
      const winnerKey = normalizeText(rawWinner);
      if (!winnerKey) {
        return '';
      }

      const runtimeSettings = typeof getRuntimeSettings === 'function' ? getRuntimeSettings() : null;
      const overrides = runtimeSettings && runtimeSettings.winnerOverrides ? runtimeSettings.winnerOverrides : {};
      return String(overrides[winnerKey] || '').replace(/\s+/g, ' ').trim();
    }

    function getWinnerGroupLabel(rawWinner) {
      const override = getWinnerOverrideLabel(rawWinner);
      if (override) {
        return override;
      }
      const entity = matchEntity(rawWinner);
      if (entity) {
        return entity;
      }
      return 'Unknown';
    }

    function getWinnerGroupKey(rawWinner) {
      return normalizeText(getWinnerGroupLabel(rawWinner));
    }

    function resolveWinnerGroupForDatabase(rawWinner) {
      const cleanWinner = String(rawWinner || '').replace(/\s+/g, ' ').trim();
      const winnerRawKey = normalizeText(cleanWinner);
      const override = getWinnerOverrideLabel(cleanWinner);
      if (override) {
        const key = normalizeText(override) || winnerRawKey;
        return {
          key,
          label: override,
          canonicalKey: normalizeText(override),
          known: true
        };
      }

      const entity = matchEntity(cleanWinner);
      if (entity) {
        const key = normalizeText(entity) || winnerRawKey;
        return {
          key,
          label: entity,
          canonicalKey: normalizeText(entity),
          known: true
        };
      }

      return {
        key: winnerRawKey ? `unknown:${winnerRawKey}` : 'unknown:blank',
        label: 'Unknown',
        canonicalKey: '',
        known: false
      };
    }

    return Object.freeze({
      parseAliasRules,
      parseAliasRuleEntries,
      serializeAliasRuleEntries,
      matchEntity,
      getGroupedKey,
      getWinnerOverrideLabel,
      getWinnerGroupLabel,
      getWinnerGroupKey,
      resolveWinnerGroupForDatabase
    });
  }

  window.CytubePollHistoryAnalyzerAliasEngine = Object.freeze({ create });
})();
