(function() {
  'use strict';

  function create(deps) {
    const normalizeText = deps && deps.normalizeText;
    const matchEntity = deps && deps.matchEntity;
    const extractTags = deps && deps.extractTags;
    const createRecord = deps && deps.createRecord;

    if (
      typeof normalizeText !== 'function'
      || typeof matchEntity !== 'function'
      || typeof extractTags !== 'function'
      || typeof createRecord !== 'function'
    ) {
      throw new Error('Poll parser requires normalizeText, matchEntity, extractTags, and createRecord dependencies.');
    }

    function extractVotesFromText(text) {
      const raw = String(text || '').replace(/\s+/g, ' ').trim();
      if (!raw) {
        return null;
      }

      const explicitVote = raw.match(/(\d+)\s*votes?\b/i);
      if (explicitVote) {
        return Number(explicitVote[1]);
      }

      const countInParens = raw.match(/\((\d+)\s*(?:votes?)?\)/i);
      if (countInParens) {
        return Number(countInParens[1]);
      }

      // Cytube poll rows sometimes render as compact prefix counts like "3Korone Song".
      const compactPrefix = raw.match(/^(\d+)(?=[^\d\s])/);
      if (compactPrefix) {
        const count = Number(compactPrefix[1]);
        if (Number.isFinite(count) && count <= 999) {
          return count;
        }
      }

      const spacedPrefix = raw.match(/^(\d+)\s+(.+)$/);
      if (spacedPrefix) {
        const count = Number(spacedPrefix[1]);
        const rest = String(spacedPrefix[2] || '').trim();
        if (Number.isFinite(count) && count <= 999 && rest) {
          return count;
        }
      }

      return null;
    }

    function stripVotePrefixFromLabel(rawLabel, votes) {
      let label = String(rawLabel || '').replace(/\s+/g, ' ').trim();
      if (!label) {
        return '';
      }
      if (!Number.isFinite(votes)) {
        return label;
      }
      label = label
        .replace(new RegExp(`^\\s*${votes}(?=[^\\d\\s])`), '')
        .replace(new RegExp(`^\\s*${votes}\\s+`), '')
        .replace(new RegExp(`^\\s*${votes}\\s*[|:\\-]\\s*`), '')
        .replace(/\s+/g, ' ')
        .trim();
      return label || String(rawLabel || '').replace(/\s+/g, ' ').trim();
    }

    function extractOptionFromElement(optionEl) {
      if (!(optionEl instanceof HTMLElement)) {
        return null;
      }

      const rawText = optionEl.textContent.replace(/\s+/g, ' ').trim();
      if (!rawText || rawText.length > 180) {
        return null;
      }

      let votes = null;
      const voteNode = optionEl.querySelector('[class*="vote"], [class*="count"], .badge');
      if (voteNode) {
        const parsed = Number((voteNode.textContent || '').match(/\d+/)?.[0]);
        if (Number.isFinite(parsed)) {
          votes = parsed;
        }
      }

      const textVotes = extractVotesFromText(rawText);
      if (!Number.isFinite(votes) || (Number.isFinite(textVotes) && textVotes > votes)) {
        votes = Number.isFinite(textVotes) ? textVotes : votes;
      }

      let label = rawText;
      if (Number.isFinite(votes)) {
        label = label
          .replace(new RegExp(`^\\s*${votes}(?=[^\\d\\s])`), '')
          .replace(new RegExp(`^\\s*${votes}\\s+`), '')
          .replace(new RegExp(`^\\s*${votes}\\s*[|:\\-]\\s*`), '')
          .replace(new RegExp(`\\b${votes}\\b\\s*votes?\\b`, 'i'), '')
          .replace(new RegExp(`\\(\\s*${votes}\\s*(?:votes?)?\\s*\\)`, 'i'), '')
          .replace(/\s+/g, ' ')
          .trim();
        label = stripVotePrefixFromLabel(label, votes);
      }
      if (!label) {
        label = rawText;
      }

      const canonicalKey = normalizeText(label);
      if (!canonicalKey) {
        return null;
      }

      const entity = matchEntity(label);
      return {
        rawLabel: label,
        votes: Number.isFinite(votes) ? votes : null,
        canonicalKey,
        entity,
        groupKey: entity ? normalizeText(entity) : canonicalKey,
        tags: extractTags(label),
        isWinner: optionEl.classList.contains('winner') || optionEl.classList.contains('text-success')
      };
    }

    function extractOptionsFromTextLines(text, title) {
      const titleNorm = normalizeText(title);
      const lines = String(text || '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const options = [];
      const seen = new Set();
      lines.forEach((line) => {
        const norm = normalizeText(line);
        if (!norm || norm === titleNorm) {
          return;
        }
        if (/^(winner|poll|created|votes?|results?)\b/i.test(line)) {
          return;
        }
        if (line.length > 180) {
          return;
        }

        const option = extractOptionFromElement({
          textContent: line,
          querySelector: () => null,
          classList: { contains: () => false }
        });
        if (!option) {
          return;
        }
        if (seen.has(option.canonicalKey)) {
          return;
        }
        seen.add(option.canonicalKey);
        options.push(option);
      });
      return options;
    }

    function extractTitle(node) {
      if (!(node instanceof HTMLElement)) {
        return '';
      }

      const candidates = [
        '.poll-title',
        '.panel-heading',
        'h3',
        'h4',
        'strong'
      ];
      for (const selector of candidates) {
        const el = node.querySelector(selector);
        if (!el) {
          continue;
        }
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        if (text.length >= 3 && text.length <= 160) {
          return text;
        }
      }

      const firstLine = node.textContent.split('\n').map((line) => line.trim()).find(Boolean) || '';
      return firstLine.slice(0, 160);
    }

    function resolveWinnerTextFromOptions(winnerText, options) {
      const candidate = String(winnerText || '').replace(/\s+/g, ' ').trim();
      const candidateKey = normalizeText(candidate);
      if (!candidateKey) {
        return '';
      }

      const safeOptions = Array.isArray(options) ? options : [];
      const exact = safeOptions.find((option) => normalizeText(option && option.rawLabel) === candidateKey);
      if (exact && exact.rawLabel) {
        return exact.rawLabel;
      }

      let best = null;
      safeOptions.forEach((option) => {
        const rawLabel = String(option && option.rawLabel || '').replace(/\s+/g, ' ').trim();
        const optionKey = normalizeText(rawLabel);
        if (!rawLabel || !optionKey) {
          return;
        }
        if (!candidateKey.includes(optionKey) && !optionKey.includes(candidateKey)) {
          return;
        }
        if (!best || optionKey.length > best.optionKey.length) {
          best = { rawLabel, optionKey };
        }
      });
      if (best) {
        return best.rawLabel;
      }

      const wordCount = candidateKey.split(' ').filter(Boolean).length;
      if (wordCount > 4) {
        return '';
      }
      return candidate;
    }

    function findWinnerByMarker(options, node) {
      const winnerOption = options.find((option) => option.isWinner);
      if (winnerOption) {
        return winnerOption.rawLabel;
      }

      if (node instanceof HTMLElement) {
        const winnerText = node.textContent.match(/winner\s*[:\-]\s*([^\n\r|]+)/i)?.[1];
        if (winnerText) {
          const resolved = resolveWinnerTextFromOptions(winnerText, options);
          return resolved || null;
        }
      }
      return null;
    }

    function parsePollNode(node, source = 'history') {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      const title = extractTitle(node);
      const optionElements = Array.from(
        node.querySelectorAll('.poll-option, .option, .poll-option-item, li, .poll_result, .result')
      );

      const options = [];
      const seen = new Set();
      optionElements.forEach((el) => {
        const parsed = extractOptionFromElement(el);
        if (!parsed) {
          return;
        }
        if (seen.has(parsed.canonicalKey)) {
          return;
        }
        seen.add(parsed.canonicalKey);
        options.push(parsed);
      });

      if (!options.length) {
        extractOptionsFromTextLines(node.textContent, title).forEach((parsed) => {
          if (seen.has(parsed.canonicalKey)) {
            return;
          }
          seen.add(parsed.canonicalKey);
          options.push(parsed);
        });
      }

      if (!title && !options.length) {
        return null;
      }

      const winnerOfficialRaw = findWinnerByMarker(options, node);
      const createdAt = Date.now();

      return createRecord({
        source,
        createdAt,
        title: title || 'Untitled Poll',
        options,
        winnerOfficialRaw,
        signatureExtra: normalizeText(node.textContent).slice(0, 400),
        rawSnippet: node.textContent.replace(/\s+/g, ' ').trim()
      });
    }

    function parseActivePollSnapshot() {
      const pollWrap = document.querySelector('#pollwrap');
      if (!pollWrap) {
        return null;
      }

      const title = extractTitle(pollWrap);
      const options = Array.from(
        pollWrap.querySelectorAll('.poll-option, .option, .poll-option-item, li, .poll_result, .result')
      )
        .map((node) => extractOptionFromElement(node))
        .filter(Boolean);

      if (!title || options.length < 2) {
        return null;
      }

      return {
        title,
        options,
        rawSnippet: pollWrap.textContent.replace(/\s+/g, ' ').trim()
      };
    }

    return Object.freeze({
      extractVotesFromText,
      stripVotePrefixFromLabel,
      extractOptionFromElement,
      extractOptionsFromTextLines,
      extractTitle,
      resolveWinnerTextFromOptions,
      findWinnerByMarker,
      parsePollNode,
      parseActivePollSnapshot
    });
  }

  window.CytubePollHistoryAnalyzerPollParser = Object.freeze({ create });
})();
