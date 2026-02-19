(function() {
  'use strict';

  function toNumberText(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return String(fallback);
    }
    return String(parsed);
  }

  function getPreviewWindowHtml() {
    return `
      <div class="logger-header">
        <span>Chat Log Preview</span>
        <button type="button" class="logger-close" data-logger-close="preview">×</button>
      </div>
      <div class="logger-content" id="cytube-chat-preview-content"></div>
    `;
  }

  function getStatsWindowHtml() {
    return `
      <div class="logger-header">
        <span>Emote Statistics</span>
        <button type="button" class="logger-close" data-logger-close="stats">×</button>
      </div>
      <div class="stats-tabs">
        <div class="stats-tab active" data-tab="global">Global</div>
        <div class="stats-tab" data-tab="user">Per User</div>
      </div>
      <div class="stats-search"><input type="text" placeholder="Search emotes/users..." id="stats-search-input"></div>
      <div class="logger-content" id="cytube-stats-preview-content"></div>
    `;
  }

  function getSettingsWindowHtml(displayLimits) {
    const limits = displayLimits && typeof displayLimits === 'object' ? displayLimits : {};
    const globalStats = toNumberText(limits.globalStats, 2000);
    const userStats = toNumberText(limits.userStats, 100);
    const topEmotesPerUser = toNumberText(limits.topEmotesPerUser, 10);
    const previewMessages = toNumberText(limits.previewMessages, 250);

    return `
      <div class="logger-header">
        <span>Logger Settings</span>
        <button type="button" class="logger-close" data-logger-close="settings">×</button>
      </div>
      <div class="logger-content">
        <div style="margin-bottom:10px;"><strong>Display Limits</strong></div>
        <label>Global stats shown: <input id="global-stats-limit" type="number" value="${globalStats}" style="width:80px;"></label><br>
        <label>User stats shown: <input id="user-stats-limit" type="number" value="${userStats}" style="width:80px;"></label><br>
        <label>Top emotes per user: <input id="top-emotes-limit" type="number" value="${topEmotesPerUser}" style="width:80px;"></label><br>
        <label>Preview messages: <input id="preview-messages-limit" type="number" value="${previewMessages}" style="width:80px;"></label><br><br>
        <button class="btn btn-sm btn-primary" id="logger-save-settings">Save Settings</button>
      </div>
    `;
  }

  function getMenuHtml() {
    return `
      <button class="btn btn-sm btn-default" id="logger-preview-btn">Preview Log</button>
      <button class="btn btn-sm btn-default" id="logger-stats-btn">Emote Stats</button>
      <button class="btn btn-sm btn-default" id="logger-export-btn">Export Stats</button>
      <button class="btn btn-sm btn-default" id="logger-settings-btn">Settings</button>
      <button class="btn btn-sm btn-danger" id="logger-clear-btn">Clear Data</button>
    `;
  }

  window.CytubeEmoteGlobalTrackerUiTemplates = Object.freeze({
    getPreviewWindowHtml,
    getStatsWindowHtml,
    getSettingsWindowHtml,
    getMenuHtml
  });
})();
