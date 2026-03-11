// Todo List Sync Engine
// Handles bidirectional sync of the To-do List with an Obsidian vault file
// via the Obsidian Local REST API plugin

class TodoSync {
  /**
   * @param {Object} config
   * @param {string} config.apiUrl - Obsidian Local REST API base URL
   * @param {string} config.apiKey - Bearer token
   * @param {string} config.todoFilePath - Vault-relative file path
   * @param {number} config.pollInterval - Polling interval in ms
   */
  constructor(config) {
    this.apiUrl = config.apiUrl || 'https://127.0.0.1:27124';
    this.apiKey = config.apiKey || '';
    this.filePath = config.todoFilePath || '9. To-do List/Todo_List.md';
    this.pollInterval = config.pollInterval || 3000;

    this.lastSyncedContent = null;
    this.connected = false;
    this.pollTimer = null;
    this.pendingLocalChanges = false;

    /** @type {function(Object):void|null} Called when remote changes detected */
    this.onRemoteChange = null;
    /** @type {function(boolean):void|null} Called when connection state changes */
    this.onConnectionChange = null;
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
   * Read the todo file from Obsidian vault
   * @returns {Promise<string|null>} Markdown content or null if not found
   */
  async readRemoteFile() {
    try {
      const encodedPath = this.filePath.split('/').map(encodeURIComponent).join('/');
      const response = await this.apiRequest('GET', `/vault/${encodedPath}`);

      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`);

      return await response.text();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        this.setConnected(false);
        return null;
      }
      throw error;
    }
  }

  /**
   * Write the todo file to Obsidian vault
   * @param {string} content - Markdown content
   * @returns {Promise<boolean>} Success status
   */
  async writeRemoteFile(content) {
    try {
      const encodedPath = this.filePath.split('/').map(encodeURIComponent).join('/');
      const response = await this.apiRequest('PUT', `/vault/${encodedPath}`, content);

      if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`);

      this.setConnected(true);
      return true;
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        this.setConnected(false);
        return false;
      }
      throw error;
    }
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

  // ─── Markdown Parsing ───

  /**
   * Parse the To-do List markdown file into structured data
   * @param {string} markdown - Full file content
   * @returns {Object} { preamble: string, sections: Array }
   */
  parseTodoMarkdown(markdown) {
    if (!markdown) return { preamble: '', sections: [] };

    const lines = markdown.split('\n');
    let preambleEndIndex = lines.length;

    // Find where the first ## section starts
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        preambleEndIndex = i;
        break;
      }
    }

    const preamble = lines.slice(0, preambleEndIndex).join('\n');
    const sections = [];
    let currentSection = null;

    for (let i = preambleEndIndex; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('## ')) {
        currentSection = {
          name: line.slice(3).trim(),
          comment: null,
          items: []
        };
        sections.push(currentSection);
        continue;
      }

      if (!currentSection) continue;

      const trimmed = line.trim();

      // HTML comment line (section description)
      if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
        currentSection.comment = trimmed;
        continue;
      }

      // Skip blank lines
      if (trimmed === '') continue;

      // Task line: - [ ] or - [x], optionally with [S] priority
      const taskMatch = trimmed.match(/^- \[([ x])\]\s+(?:\[([SABC])\]\s+)?(.+)$/);
      if (taskMatch) {
        const [, checkbox, priority, rawContent] = taskMatch;
        let text = rawContent.trim();
        let reference = null;
        let category = null;

        // Extract wikilink reference: content ← [[ref]]
        const refMatch = rawContent.match(/^(.+?)\s+←\s+(\[\[.+?\]\])$/);
        if (refMatch) {
          text = refMatch[1].trim();
          reference = refMatch[2];
        }

        // Extract category tag: content #家庭
        const catMatch = text.match(/^(.+?)\s+#(家庭|工作|健康|学习)$/);
        if (catMatch) {
          text = catMatch[1].trim();
          category = catMatch[2];
        }

        currentSection.items.push({
          id: this.generateId(),
          text,
          reference,
          priority: priority || null,
          category,
          completed: checkbox === 'x',
          order: currentSection.items.length
        });
      }
    }

    return { preamble, sections };
  }

  /**
   * Serialize structured data back to markdown
   * @param {Object} data - { preamble, sections }
   * @returns {string} Full markdown content
   */
  toMarkdown(data) {
    let result = data.preamble || '';
    // Ensure preamble ends with exactly one newline
    result = result.replace(/\n*$/, '\n');

    for (const section of data.sections) {
      result += `## ${section.name}\n`;
      if (section.comment) {
        result += `${section.comment}\n`;
      }

      const sorted = [...section.items].sort((a, b) => a.order - b.order);
      for (const item of sorted) {
        const check = item.completed ? 'x' : ' ';
        const pri = item.priority ? `[${item.priority}] ` : '';
        const cat = item.category ? ` #${item.category}` : '';
        const ref = item.reference ? ` ← ${item.reference}` : '';
        result += `- [${check}] ${pri}${item.text}${cat}${ref}\n`;
      }

      result += '\n';
    }

    return result;
  }

  /**
   * Get display text from a wikilink reference
   * @param {string} reference - e.g. "[[filename|display]]" or "[[filename]]"
   * @returns {string} Display text
   */
  static getRefDisplay(reference) {
    if (!reference) return '';
    const inner = reference.slice(2, -2);
    const pipeIndex = inner.indexOf('|');
    return pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : inner;
  }

  /**
   * Match remote items to local items by text content to preserve IDs
   * @param {Object} remoteData - Parsed remote data
   * @param {Object} localData - Local data with existing IDs
   * @returns {Object} Remote data with matched local IDs
   */
  matchRemoteToLocal(remoteData, localData) {
    if (!localData?.sections) return remoteData;

    // Build a map of local items by section name + text
    const localMap = new Map();
    for (const section of localData.sections) {
      for (const item of section.items) {
        const key = `${section.name}||${item.text}`;
        if (!localMap.has(key)) localMap.set(key, item);
      }
    }

    const usedIds = new Set();

    for (const section of remoteData.sections) {
      for (const item of section.items) {
        // Try exact match (section + text)
        const key = `${section.name}||${item.text}`;
        const local = localMap.get(key);
        if (local && !usedIds.has(local.id)) {
          usedIds.add(local.id);
          item.id = local.id;
        }
      }
    }

    return remoteData;
  }

  // ─── Sync Operations ───

  /**
   * Sync local data to remote Obsidian file
   * @param {Object} data - { preamble, sections }
   * @returns {Promise<boolean>} Success status
   */
  async syncToRemote(data) {
    const markdown = this.toMarkdown(data);
    const success = await this.writeRemoteFile(markdown);
    if (success) {
      this.lastSyncedContent = markdown;
      this.pendingLocalChanges = false;
    }
    return success;
  }

  /**
   * Check for remote changes and notify if detected
   * @returns {Promise<void>}
   */
  async checkRemoteChanges() {
    try {
      const remoteMd = await this.readRemoteFile();
      if (remoteMd === null) return;

      this.setConnected(true);

      // Skip if content hasn't changed
      if (remoteMd === this.lastSyncedContent) return;

      // Skip if we have pending local changes (local wins during active editing)
      if (this.pendingLocalChanges) return;

      // Remote content changed — parse and notify
      const data = this.parseTodoMarkdown(remoteMd);
      this.lastSyncedContent = remoteMd;
      this.onRemoteChange?.(data);
    } catch (error) {
      console.error('Todo sync check failed:', error);
    }
  }

  /**
   * Start polling for remote changes
   */
  startPolling() {
    if (this.pollTimer) return;
    this.checkRemoteChanges();
    this.pollTimer = setInterval(() => this.checkRemoteChanges(), this.pollInterval);
  }

  /**
   * Stop polling for remote changes
   */
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Generate a unique ID
   * @returns {string}
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
