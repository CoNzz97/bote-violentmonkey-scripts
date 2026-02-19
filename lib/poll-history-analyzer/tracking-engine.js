(function() {
  'use strict';

  function create(deps) {
    const state = deps && deps.state;
    const parsePollNode = deps && deps.parsePollNode;
    const parseActivePollSnapshot = deps && deps.parseActivePollSnapshot;
    const addRecord = deps && deps.addRecord;
    const createRecord = deps && deps.createRecord;
    const stripVotePrefixFromLabel = deps && deps.stripVotePrefixFromLabel;
    const extractVotesFromText = deps && deps.extractVotesFromText;
    const buildActivePollSignature = deps && deps.buildActivePollSignature;
    const waitForEl = deps && deps.waitForEl;
    const pollHistorySelector = String((deps && deps.pollHistorySelector) || '#pollhistory');
    const pollWrapSelector = String((deps && deps.pollWrapSelector) || '#pollwrap');

    if (
      !state
      || typeof parsePollNode !== 'function'
      || typeof parseActivePollSnapshot !== 'function'
      || typeof addRecord !== 'function'
      || typeof createRecord !== 'function'
      || typeof stripVotePrefixFromLabel !== 'function'
      || typeof buildActivePollSignature !== 'function'
      || typeof waitForEl !== 'function'
    ) {
      throw new Error('Tracking engine requires state, parse helpers, addRecord, createRecord, stripVotePrefixFromLabel, buildActivePollSignature, and waitForEl.');
    }

    function scanPollHistory(force = false) {
      const pollHistory = document.querySelector(pollHistorySelector);
      if (!pollHistory) {
        return;
      }

      const nodes = Array.from(pollHistory.children).filter((child) => child instanceof HTMLElement);
      nodes.forEach((node) => {
        if (!force && node.dataset.pollHistoryAnalyzerSeen === '1') {
          return;
        }
        const record = parsePollNode(node, 'history');
        if (record) {
          addRecord(record);
        }
        node.dataset.pollHistoryAnalyzerSeen = '1';
      });
    }

    function scheduleHistoryScan(force = false) {
      if (state.scanTimer) {
        return;
      }
      state.scanTimer = setTimeout(() => {
        state.scanTimer = null;
        scanPollHistory(force);
      }, 200);
    }

    function clearSoftWinnerTimer() {
      if (!state.softWinnerTimer) {
        return;
      }
      clearTimeout(state.softWinnerTimer);
      state.softWinnerTimer = null;
    }

    function getOptionVote(option) {
      if (!option || typeof option !== 'object') {
        return null;
      }
      if (Number.isFinite(option.votes)) {
        return Number(option.votes);
      }
      if (typeof extractVotesFromText === 'function') {
        const fallbackVotes = extractVotesFromText(option.rawLabel);
        return Number.isFinite(fallbackVotes) ? Number(fallbackVotes) : null;
      }
      return null;
    }

    function determineSoftWinner(options) {
      const voted = options
        .map((option) => {
          const votes = getOptionVote(option);
          if (!Number.isFinite(votes)) {
            return null;
          }
          return { option, votes };
        })
        .filter(Boolean);
      if (!voted.length) {
        return { winner: null, tie: false };
      }

      let max = -1;
      voted.forEach((entry) => {
        if (entry.votes > max) {
          max = entry.votes;
        }
      });
      const winners = voted.filter((entry) => entry.votes === max);
      if (!winners.length) {
        return { winner: null, tie: false };
      }
      if (winners.length === 1) {
        const winnerLabel = stripVotePrefixFromLabel(winners[0].option.rawLabel, winners[0].votes);
        return { winner: winnerLabel, tie: false };
      }
      return {
        winner: winners.map((entry) => stripVotePrefixFromLabel(entry.option.rawLabel, entry.votes)).join(' | '),
        tie: true
      };
    }

    function findLatestNoWinnerRecord() {
      return state.records.find((record) => (
        record
        && record.winnerMode === 'none'
        && Array.isArray(record.options)
        && record.options.length >= 2
      )) || null;
    }

    function captureSoftWinnerFromRecord(record, reason = 'manual-history') {
      if (!record || !Array.isArray(record.options) || record.options.length < 2) {
        return false;
      }

      const soft = determineSoftWinner(record.options);
      if (!soft.winner) {
        return false;
      }

      const signatureKey = `${record.hash}|${reason}`;
      if (state.completedSoftSignatures.has(signatureKey)) {
        return false;
      }

      const optionsWithVotes = record.options.map((option) => {
        const votes = getOptionVote(option);
        return {
          ...option,
          votes: Number.isFinite(votes) ? votes : null
        };
      });

      const softRecord = createRecord({
        source: 'history-soft',
        createdAt: Date.now(),
        title: record.title,
        options: optionsWithVotes,
        winnerSoftRaw: soft.winner,
        softTie: soft.tie,
        signatureExtra: signatureKey,
        rawSnippet: record.rawSnippet
      });

      if (addRecord(softRecord)) {
        state.completedSoftSignatures.add(signatureKey);
        return true;
      }
      return false;
    }

    function captureSoftWinner(reason = 'timer') {
      const isManual = reason === 'manual';
      const snapshot = parseActivePollSnapshot();
      if (!snapshot) {
        if (isManual) {
          const fallbackRecord = findLatestNoWinnerRecord();
          if (fallbackRecord) {
            captureSoftWinnerFromRecord(fallbackRecord, 'manual-history');
          }
        }
        return;
      }

      const signatureTs = state.activePollFirstSeenTs || Date.now();
      const snapshotSignature = buildActivePollSignature(snapshot, signatureTs);
      if (!snapshotSignature) {
        return;
      }

      const expectedSignature = state.activePollSignature;
      if (!isManual && (!expectedSignature || snapshotSignature !== expectedSignature)) {
        return;
      }
      if (isManual && (!expectedSignature || snapshotSignature !== expectedSignature)) {
        const manualTs = state.activePollFirstSeenTs || Date.now();
        state.activePollFirstSeenTs = manualTs;
        state.activePollSignature = buildActivePollSignature(snapshot, manualTs);
        if (!state.activePollSignature) {
          return;
        }
      }
      const activeSignature = state.activePollSignature || snapshotSignature;

      const soft = determineSoftWinner(snapshot.options);
      if (!soft.winner) {
        if (isManual) {
          const fallbackRecord = findLatestNoWinnerRecord();
          if (fallbackRecord) {
            captureSoftWinnerFromRecord(fallbackRecord, 'manual-history');
          }
        }
        return;
      }

      const voteSignature = snapshot.options
        .map((option) => {
          const votes = getOptionVote(option);
          return Number.isFinite(votes) ? String(votes) : 'x';
        })
        .join('|');
      const firstSeenKey = state.activePollFirstSeenTs || 'manual';
      const signatureKey = `${activeSignature}|${firstSeenKey}|${voteSignature}`;
      if (state.completedSoftSignatures.has(signatureKey)) {
        return;
      }

      const record = createRecord({
        source: 'active-soft',
        createdAt: Date.now(),
        title: snapshot.title,
        options: snapshot.options,
        winnerSoftRaw: soft.winner,
        softTie: soft.tie,
        signatureExtra: `${signatureKey}|${reason}`,
        rawSnippet: snapshot.rawSnippet
      });

      if (addRecord(record)) {
        state.completedSoftSignatures.add(signatureKey);
      }
    }

    function scheduleSoftWinner(snapshot) {
      clearSoftWinnerTimer();
      const delayMs = state.settings.softWinnerDelaySec * 1000;
      state.softWinnerTimer = setTimeout(() => captureSoftWinner('delay'), delayMs);
    }

    function checkActivePoll() {
      const snapshot = parseActivePollSnapshot();
      if (!snapshot) {
        state.activePollSignature = '';
        state.activePollFirstSeenTs = 0;
        clearSoftWinnerTimer();
        return;
      }

      const nowTs = Date.now();
      const snapshotSignature = buildActivePollSignature(snapshot, nowTs);
      if (!snapshotSignature) {
        return;
      }

      if (snapshotSignature === state.activePollSignature) {
        return;
      }

      state.activePollSignature = snapshotSignature;
      state.activePollFirstSeenTs = nowTs;
      scheduleSoftWinner(snapshot);
    }

    function scheduleActivePollCheck() {
      if (state.activeCheckTimer) {
        return;
      }
      state.activeCheckTimer = setTimeout(() => {
        state.activeCheckTimer = null;
        checkActivePoll();
      }, 300);
    }

    function stopHistoryObserver() {
      if (!state.historyObserver) {
        return;
      }
      state.historyObserver.disconnect();
      state.historyObserver = null;
    }

    function startHistoryObserver() {
      if (state.historyObserver) {
        return true;
      }
      const pollHistory = document.querySelector(pollHistorySelector);
      if (!pollHistory) {
        return false;
      }

      state.historyObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'childList') {
            continue;
          }
          if (mutation.addedNodes.length || mutation.removedNodes.length) {
            scheduleHistoryScan(false);
            return;
          }
        }
      });
      state.historyObserver.observe(pollHistory, { childList: true, subtree: true });
      return true;
    }

    function stopActivePollObserver() {
      if (!state.activePollObserver) {
        return;
      }
      state.activePollObserver.disconnect();
      state.activePollObserver = null;
    }

    function startActivePollObserver() {
      if (state.activePollObserver) {
        return true;
      }
      const pollWrap = document.querySelector(pollWrapSelector);
      if (!pollWrap) {
        return false;
      }

      state.activePollObserver = new MutationObserver(() => {
        scheduleActivePollCheck();
      });
      state.activePollObserver.observe(pollWrap, { childList: true, characterData: true, subtree: true });
      return true;
    }

    function syncHistoryObserver() {
      if (!state.settings.enabled) {
        stopHistoryObserver();
        return;
      }
      if (startHistoryObserver()) {
        return;
      }
      if (state.waitingForPollHistory) {
        return;
      }
      state.waitingForPollHistory = true;
      waitForEl(pollHistorySelector).then(() => {
        state.waitingForPollHistory = false;
        if (state.settings.enabled) {
          startHistoryObserver();
          scheduleHistoryScan(true);
        }
      });
    }

    function syncActivePollObserver() {
      if (!state.settings.enabled) {
        stopActivePollObserver();
        clearSoftWinnerTimer();
        return;
      }
      if (startActivePollObserver()) {
        return;
      }
      if (state.waitingForPollWrap) {
        return;
      }
      state.waitingForPollWrap = true;
      waitForEl(pollWrapSelector).then(() => {
        state.waitingForPollWrap = false;
        if (state.settings.enabled) {
          startActivePollObserver();
          checkActivePoll();
        }
      });
    }

    function syncTrackingState() {
      if (!state.settings.enabled) {
        stopHistoryObserver();
        stopActivePollObserver();
        clearSoftWinnerTimer();
        return;
      }
      scheduleHistoryScan(true);
      checkActivePoll();
      syncHistoryObserver();
      syncActivePollObserver();
    }

    return Object.freeze({
      scanPollHistory,
      scheduleHistoryScan,
      clearSoftWinnerTimer,
      getOptionVote,
      determineSoftWinner,
      findLatestNoWinnerRecord,
      captureSoftWinnerFromRecord,
      captureSoftWinner,
      scheduleSoftWinner,
      checkActivePoll,
      scheduleActivePollCheck,
      stopHistoryObserver,
      startHistoryObserver,
      stopActivePollObserver,
      startActivePollObserver,
      syncHistoryObserver,
      syncActivePollObserver,
      syncTrackingState
    });
  }

  window.CytubePollHistoryAnalyzerTrackingEngine = Object.freeze({ create });
})();
