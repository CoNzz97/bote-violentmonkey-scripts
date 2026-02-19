(function() {
  'use strict';

  function create(deps) {
    const normalizeText = deps && deps.normalizeText;
    const simpleHash = deps && deps.simpleHash;
    const extractPollClockToken = deps && deps.extractPollClockToken;
    const normalizeTitleForHash = deps && deps.normalizeTitleForHash;
    const getWinnerGroupKey = deps && deps.getWinnerGroupKey;
    const hashBucketMs = Number(deps && deps.hashBucketMs) || (6 * 60 * 60 * 1000);

    if (
      typeof normalizeText !== 'function'
      || typeof simpleHash !== 'function'
      || typeof extractPollClockToken !== 'function'
      || typeof normalizeTitleForHash !== 'function'
      || typeof getWinnerGroupKey !== 'function'
    ) {
      throw new Error('Record model requires normalizeText, simpleHash, extractPollClockToken, normalizeTitleForHash, and getWinnerGroupKey.');
    }

    function buildRecordHashInput(base, createdAt, options) {
      const safeBase = base && typeof base === 'object' ? base : {};
      const safeOptions = Array.isArray(options) ? options : [];
      const optionKeys = Array.from(new Set(
        safeOptions
          .map((option) => normalizeText((option && (option.canonicalKey || option.rawLabel)) || ''))
          .filter(Boolean)
      )).sort();
      const pollClock = extractPollClockToken(`${safeBase.title || ''} ${safeBase.rawSnippet || ''}`);
      const normalizedTitle = normalizeTitleForHash(safeBase.title || '');
      const normalizedSnippet = normalizeText(safeBase.rawSnippet || '').slice(0, 120);
      const bucket = Number.isFinite(createdAt) ? Math.floor(createdAt / hashBucketMs) : 0;

      if (optionKeys.length) {
        return [
          optionKeys.join('|'),
          pollClock ? `clock:${pollClock}` : `bucket:${bucket}`,
          `count:${optionKeys.length}`
        ].join('::');
      }

      return [
        normalizedTitle || normalizedSnippet,
        pollClock ? `clock:${pollClock}` : `bucket:${bucket}`,
        normalizedSnippet
      ].join('::');
    }

    function winnerModeRank(mode) {
      if (mode === 'official') {
        return 3;
      }
      if (mode === 'soft') {
        return 2;
      }
      return 1;
    }

    function getWinnerRaw(record) {
      if (!record || typeof record !== 'object') {
        return '';
      }
      if (record.winnerMode === 'official') {
        return String(record.winnerOfficialRaw || '').trim();
      }
      if (record.winnerMode === 'soft') {
        return String(record.winnerSoftRaw || '').trim();
      }
      return '';
    }

    function shouldPreferRecord(candidate, existing) {
      if (!candidate) {
        return false;
      }
      if (!existing) {
        return true;
      }

      const candidateRank = winnerModeRank(candidate.winnerMode);
      const existingRank = winnerModeRank(existing.winnerMode);
      if (candidateRank !== existingRank) {
        return candidateRank > existingRank;
      }

      const candidateWinner = normalizeText(getWinnerRaw(candidate));
      const existingWinner = normalizeText(getWinnerRaw(existing));
      if (candidateWinner !== existingWinner) {
        return candidate.createdAt >= existing.createdAt;
      }

      const candidateOptions = Array.isArray(candidate.options) ? candidate.options.length : 0;
      const existingOptions = Array.isArray(existing.options) ? existing.options.length : 0;
      if (candidateOptions !== existingOptions) {
        return candidateOptions > existingOptions;
      }

      return candidate.createdAt > existing.createdAt;
    }

    function createRecord(base) {
      const createdAt = Number(base.createdAt) || Date.now();
      const safeOptions = Array.isArray(base.options) ? base.options : [];
      const winnerOfficialRaw = String(base.winnerOfficialRaw || '').trim() || null;
      const winnerSoftRaw = String(base.winnerSoftRaw || '').trim() || null;
      const winnerMode = winnerOfficialRaw ? 'official' : (winnerSoftRaw ? 'soft' : 'none');

      const hash = simpleHash(buildRecordHashInput(base, createdAt, safeOptions));
      const winnerOfficialGroup = winnerOfficialRaw ? getWinnerGroupKey(winnerOfficialRaw) : null;
      const winnerSoftGroup = winnerSoftRaw ? getWinnerGroupKey(winnerSoftRaw) : null;

      return {
        id: `${hash}-${createdAt}`,
        hash,
        source: base.source || 'history',
        createdAt,
        title: String(base.title || 'Untitled Poll').slice(0, 160),
        options: safeOptions,
        winnerMode,
        winnerOfficialRaw,
        winnerOfficialGroup,
        winnerSoftRaw,
        winnerSoftGroup,
        softTie: Boolean(base.softTie),
        rawSnippet: String(base.rawSnippet || '').slice(0, 500)
      };
    }

    function sanitizeOption(raw) {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const rawLabel = String(raw.rawLabel || '').replace(/\s+/g, ' ').trim();
      const canonicalKey = normalizeText(raw.canonicalKey || rawLabel);
      if (!rawLabel || !canonicalKey) {
        return null;
      }
      return {
        rawLabel,
        votes: Number.isFinite(Number(raw.votes)) ? Number(raw.votes) : null,
        canonicalKey,
        entity: raw.entity ? String(raw.entity) : null,
        groupKey: normalizeText(raw.groupKey || canonicalKey),
        tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
      };
    }

    function sanitizeRecord(raw) {
      if (!raw || typeof raw !== 'object') {
        return null;
      }
      const createdAt = Number(raw.createdAt);
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        return null;
      }
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .map(sanitizeOption)
        .filter(Boolean);
      const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
      if (!title) {
        return null;
      }

      const winnerOfficialRaw = raw.winnerOfficialRaw ? String(raw.winnerOfficialRaw).trim() : null;
      const winnerSoftRaw = raw.winnerSoftRaw ? String(raw.winnerSoftRaw).trim() : null;
      const winnerMode = winnerOfficialRaw ? 'official' : (winnerSoftRaw ? 'soft' : 'none');
      const hash = simpleHash(buildRecordHashInput({
        title,
        rawSnippet: String(raw.rawSnippet || '')
      }, createdAt, options));

      return {
        id: String(raw.id || `${hash}-${createdAt}`),
        hash,
        source: String(raw.source || 'history'),
        createdAt,
        title: title.slice(0, 160),
        options,
        winnerMode,
        winnerOfficialRaw,
        winnerOfficialGroup: winnerOfficialRaw ? normalizeText(raw.winnerOfficialGroup || getWinnerGroupKey(winnerOfficialRaw)) : null,
        winnerSoftRaw,
        winnerSoftGroup: winnerSoftRaw ? normalizeText(raw.winnerSoftGroup || getWinnerGroupKey(winnerSoftRaw)) : null,
        softTie: Boolean(raw.softTie),
        rawSnippet: String(raw.rawSnippet || '').slice(0, 500)
      };
    }

    function buildActivePollSignature(snapshot, referenceTs) {
      if (!snapshot || !Array.isArray(snapshot.options)) {
        return '';
      }
      const ts = Number(referenceTs) || Date.now();
      return simpleHash(buildRecordHashInput({
        title: snapshot.title,
        rawSnippet: snapshot.rawSnippet
      }, ts, snapshot.options));
    }

    return Object.freeze({
      buildRecordHashInput,
      winnerModeRank,
      shouldPreferRecord,
      getWinnerRaw,
      createRecord,
      sanitizeOption,
      sanitizeRecord,
      buildActivePollSignature
    });
  }

  window.CytubePollHistoryAnalyzerRecordModel = Object.freeze({ create });
})();
