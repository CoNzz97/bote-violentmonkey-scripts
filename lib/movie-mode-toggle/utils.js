(function() {
  'use strict';

  function readStoredBoolean(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (raw === null || raw === undefined) {
        return Boolean(fallback);
      }
      return raw === 'true';
    } catch (err) {
      return Boolean(fallback);
    }
  }

  function saveStoredBoolean(storage, key, value) {
    try {
      storage.setItem(key, String(Boolean(value)));
    } catch (err) {
      // Keep runtime stable on storage failure.
    }
  }

  window.CytubeMovieModeToggleUtils = Object.freeze({
    readStoredBoolean,
    saveStoredBoolean
  });
})();
