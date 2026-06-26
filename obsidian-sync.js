// Obsidian Sync Engine
// Handles bidirectional sync between Chrome extension and Obsidian vault
// via the Obsidian Local REST API plugin

class ObsidianSync {
  /**
   * @param {Object} config
   * @param {string} config.apiKey - Obsidian Local REST API Bearer token
   * @param {string} config.vaultPath - Folder path within vault (e.g. "0. 目标及计划/Daily")
   * @param {number} config.pollInterval - Polling interval in ms (default 3000)
   */
  constructor(config) {
    this.apiUrl = 'https://127.0.0.1:27124';
    // Strip an accidental "Bearer " prefix / surrounding spaces — apiRequest adds
    // "Bearer " itself, so a pasted "Bearer xxx" would become "Bearer Bearer xxx" → 401.
    this.apiKey = (config.apiKey || '').trim().replace(/^Bearer\s+/i, '');
    this.vaultPath = config.vaultPath || '1_memory/tasks';

    this.connected = false;

    /** @type {function(boolean):void|null} Called when connection state changes */
    this.onConnectionChange = null;
  }

  /**
   * Get today's file path within the vault
   * @returns {string} e.g. "0. 目标及计划/Daily/20260209_Daily_Tasks.md"
   */
  async appendTodayCompletion(text, category) {
    try {
      const now = new Date();
      const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      const cat = category ? ' #' + category : '';
      const line = '- ' + hm + ' ' + text + cat;
      const existing = await this.readTodayCompletionLog();
      let content;
      if (existing == null) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const readable = y + '-' + m + '-' + d;
        content = '---\ndate: ' + readable + '\ntype: completion-log\n---\n# ' + readable + ' 完成日志\n\n' + line + '\n';
      } else {
        if (existing.indexOf(line) !== -1) return true;
        content = existing.replace(/\n*$/, '') + '\n' + line + '\n';
      }
      const filePath = this.getTodayCompletionLogPath();
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const res = await this.apiRequest('PUT', `/vault/${encodedPath}`, content);
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  getTodayCompletionLogPath() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${this.vaultPath}/${y}${m}${d}_完成日志.md`;
  }

  async readTodayCompletionLog() {
    try {
      const filePath = this.getTodayCompletionLogPath();
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const response = await this.apiRequest('GET', `/vault/${encodedPath}`);
      if (response.status === 404 || !response.ok) return null;
      return await response.text();
    } catch (e) {
      return null;
    }
  }

  /**
   * Make an API request to Obsidian Local REST API
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {string|null} body - Request body
   * @returns {Promise<Response>}
   */
  async apiRequest(method, path, body = null) {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (method === 'GET') {
      headers['Accept'] = 'text/markdown';
    }
    if (body !== null) {
      headers['Content-Type'] = 'text/markdown';
    }

    const options = { method, headers };
    if (body !== null) {
      options.body = body;
    }

    return fetch(`${this.apiUrl}${path}`, options);
  }

  /**
   * Update connection state and notify listener
   * @param {boolean} connected
   */
  setConnected(connected) {
    if (this.connected !== connected) {
      this.connected = connected;
      this.onConnectionChange?.(connected);
    }
  }

  // ─── Markdown Serialization ───

  /**
   * Task line regex (with metadata)
   * Matches: "- [ ] [S] Content  <!-- id:abc order:0 -->"
   * Groups: [1]=checkbox [2]=priority|undefined [3]=content [4]=id [5]=order [6]=completedAt|undefined
   */
  static TASK_REGEX = /^- \[([ x])\]\s*(?:\[([SABC])\]\s*)?(.+?)\s*<!--\s*id:(\S+)\s+order:(\d+)(?:\s+completed:(\S+))?\s*-->$/;

  /**
   * Bare task line regex (no metadata, e.g. manually added in Obsidian)
   * Matches: "- [ ] [S] Content" or "- [ ] Content"
   * Groups: [1]=checkbox [2]=priority|undefined [3]=content
   */
  static BARE_TASK_REGEX = /^- \[([ x])\]\s*(?:\[([SABC])\]\s*)?(.+)$/;

  // ─── Sync Operations ───

  /**
   * Test connection to Obsidian Local REST API
   * Tries HTTPS first (port 27124), then falls back to HTTP (port 27123).
   * The root endpoint returns 200 even with a wrong/empty key, so we must read
   * its `authenticated` field — that is the real API-key check.
   * @returns {Promise<{ok: boolean, reason: 'connected'|'unauthorized'|'offline'}>}
   */
  async testConnection() {
    const urls = ['https://127.0.0.1:27124', 'http://127.0.0.1:27123'];
    let reachedServer = false;

    for (const url of urls) {
      try {
        const response = await fetch(`${url}/`, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (response.ok) {
          reachedServer = true;
          // Default to true for older plugin versions that lack the field.
          let authenticated = true;
          try {
            const data = await response.json();
            if (typeof data.authenticated === 'boolean') {
              authenticated = data.authenticated;
            }
          } catch {
            // Non-JSON body — fall back to treating reachability as success.
          }
          if (authenticated) {
            this.apiUrl = url;
            this.setConnected(true);
            return { ok: true, reason: 'connected' };
          }
        }
      } catch {
        // This URL is unreachable — try the next one.
      }
    }

    this.setConnected(false);
    return { ok: false, reason: reachedServer ? 'unauthorized' : 'offline' };
  }
}
