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
    this.apiKey = config.apiKey || '';
    this.vaultPath = config.vaultPath || '0. 目标及计划/Daily';
    this.pollInterval = config.pollInterval || 3000;

    this.lastSyncedContent = null;
    this.connected = false;
    this.pollTimer = null;
    this.pendingLocalChanges = false;

    /** @type {function(Array):void|null} Called when remote changes detected */
    this.onRemoteChange = null;
    /** @type {function(boolean):void|null} Called when connection state changes */
    this.onConnectionChange = null;
  }

  /**
   * Get today's file path within the vault
   * @returns {string} e.g. "0. 目标及计划/Daily/2026-02-09.md"
   */
  getTodayFilePath() {
    const today = new Date().toISOString().split('T')[0];
    return `${this.vaultPath}/${today}.md`;
  }

  /**
   * Get today's date string
   * @returns {string} e.g. "2026-02-09"
   */
  getTodayDate() {
    return new Date().toISOString().split('T')[0];
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
   * Read today's task file from Obsidian vault
   * @returns {Promise<string|null>} Markdown content or null if file doesn't exist
   */
  async readRemoteFile() {
    try {
      const filePath = this.getTodayFilePath();
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const response = await this.apiRequest('GET', `/vault/${encodedPath}`);

      if (response.status === 404) {
        return null; // File doesn't exist yet
      }
      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        // Network error - Obsidian likely not running
        this.setConnected(false);
        return null;
      }
      throw error;
    }
  }

  /**
   * Write task file to Obsidian vault
   * @param {string} content - Markdown content
   * @returns {Promise<boolean>} Success status
   */
  async writeRemoteFile(content) {
    try {
      const filePath = this.getTodayFilePath();
      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const response = await this.apiRequest('PUT', `/vault/${encodedPath}`, content);

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

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

  /**
   * Serialize a single task object to a markdown line
   * @param {Object} task - Task object
   * @returns {string} Markdown line
   */
  taskToMarkdown(task) {
    const check = task.completed ? 'x' : ' ';
    const priority = task.priority ? `[${task.priority}] ` : '';
    return `- [${check}] ${priority}${task.content}`;
  }

  /**
   * Serialize task arrays to full markdown file content
   * @param {Array} activeTasks - Active tasks sorted by order
   * @param {Array} completedTasks - Completed tasks sorted by completedAt
   * @returns {string} Full markdown file content
   */
  tasksToMarkdown(activeTasks, completedTasks) {
    const today = this.getTodayDate();
    const lines = [
      '---',
      `date: ${today}`,
      'type: daily-tasks',
      '---',
      `# 今日任务`,
      '',
      '## Active',
      '',
    ];

    if (activeTasks.length > 0) {
      activeTasks.forEach(task => {
        lines.push(this.taskToMarkdown(task));
      });
    }

    lines.push('');
    lines.push('## Completed');
    lines.push('');

    if (completedTasks.length > 0) {
      completedTasks.forEach(task => {
        lines.push(this.taskToMarkdown(task));
      });
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Parse a markdown task line into a task object
   * @param {string} line - Markdown line
   * @returns {Object|null} Task object or null if not a valid task line
   */
  parseTaskLine(line) {
    const match = line.match(ObsidianSync.TASK_REGEX);
    if (!match) return null;

    const [, checkbox, priority, content, id, order, completedAt] = match;

    return {
      id,
      content: content.trim(),
      priority: priority || null,
      completed: checkbox === 'x',
      order: parseInt(order, 10),
      createdAt: this.getTodayDate(),
      completedAt: completedAt || null,
    };
  }

  /**
   * Parse a bare task line (no metadata) into a task object
   * @param {string} line - Markdown line
   * @param {boolean} inCompletedSection - Whether we're in the Completed section
   * @param {number} orderCounter - Current order counter
   * @returns {Object|null} Task object or null if not a bare task line
   */
  parseBareTaskLine(line, inCompletedSection, orderCounter) {
    const match = line.match(ObsidianSync.BARE_TASK_REGEX);
    if (!match) return null;

    const [, checkbox, priority, content] = match;
    const completed = checkbox === 'x' || inCompletedSection;

    return {
      id: this.generateId(),
      content: content.trim(),
      priority: priority || null,
      completed,
      order: orderCounter,
      createdAt: this.getTodayDate(),
      completedAt: completed ? new Date().toISOString() : null,
    };
  }

  /**
   * Generate a unique ID (same format as TaskManager)
   * @returns {string}
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Parse full markdown file content into task array
   * Handles both metadata-tagged tasks and bare Obsidian tasks
   * @param {string} markdown - Full file content
   * @returns {Array} Array of task objects
   */
  markdownToTasks(markdown) {
    if (!markdown) return [];

    const tasks = [];
    const lines = markdown.split('\n');
    let inCompletedSection = false;
    let orderCounter = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Track which section we're in
      if (trimmed === '## Active') {
        inCompletedSection = false;
        orderCounter = 0;
        continue;
      }
      if (trimmed === '## Completed') {
        inCompletedSection = true;
        orderCounter = 0;
        continue;
      }

      // Try parsing as a metadata-tagged task first
      const task = this.parseTaskLine(trimmed);
      if (task) {
        // Override completed status based on checkbox (trust markdown over metadata)
        tasks.push(task);
        orderCounter++;
        continue;
      }

      // Try parsing as a bare task (manually added in Obsidian)
      const bareTask = this.parseBareTaskLine(trimmed, inCompletedSection, orderCounter);
      if (bareTask) {
        tasks.push(bareTask);
        orderCounter++;
      }
    }

    return tasks;
  }

  /**
   * Match remote tasks (parsed from clean markdown) to local tasks by content
   * Restores IDs, createdAt, and completedAt from local state
   * @param {Array} remoteTasks - Tasks parsed from remote markdown
   * @param {Array} localTasks - All local tasks
   * @returns {Array} Remote tasks with matched local metadata
   */
  matchRemoteToLocal(remoteTasks, localTasks) {
    const today = this.getTodayDate();
    const todayLocal = localTasks.filter(t => t.createdAt === today);
    const localMap = new Map();
    for (const t of todayLocal) {
      // Use content+completed as key to avoid active/completed same-name conflicts
      const key = `${t.content}||${t.completed}`;
      if (!localMap.has(key)) localMap.set(key, t);
    }

    const usedIds = new Set();

    return remoteTasks.map(remote => {
      // Try exact match (content + same completed status)
      const key = `${remote.content}||${remote.completed}`;
      const local = localMap.get(key);
      if (local && !usedIds.has(local.id)) {
        usedIds.add(local.id);
        return {
          ...remote,
          id: local.id,
          createdAt: local.createdAt,
          completedAt: remote.completed ? (local.completedAt || remote.completedAt) : null,
        };
      }
      // Try alternate match (content matches but completed status changed on mobile)
      const keyAlt = `${remote.content}||${!remote.completed}`;
      const localAlt = localMap.get(keyAlt);
      if (localAlt && !usedIds.has(localAlt.id)) {
        usedIds.add(localAlt.id);
        return {
          ...remote,
          id: localAlt.id,
          createdAt: localAlt.createdAt,
          completedAt: remote.completed ? (localAlt.completedAt || remote.completedAt) : null,
        };
      }
      return remote; // New task, keep generated ID
    });
  }

  // ─── Sync Operations ───

  /**
   * Sync local tasks to remote Obsidian file
   * @param {Array} allTasks - All tasks (including non-today tasks)
   * @returns {Promise<boolean>} Success status
   */
  async syncToRemote(allTasks) {
    const today = this.getTodayDate();
    const todayTasks = allTasks.filter(t => t.createdAt === today);

    const activeTasks = todayTasks
      .filter(t => !t.completed)
      .sort((a, b) => a.order - b.order);

    const completedTasks = todayTasks
      .filter(t => t.completed)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    const markdown = this.tasksToMarkdown(activeTasks, completedTasks);

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

      if (remoteMd === null) {
        // File doesn't exist — if we have no local connection, skip
        // If connected but no file, that's OK (no tasks yet)
        return;
      }

      this.setConnected(true);

      // Skip if content hasn't changed
      if (remoteMd === this.lastSyncedContent) {
        return;
      }

      // Skip if we have pending local changes (local wins during active editing)
      if (this.pendingLocalChanges) {
        return;
      }

      // Remote content changed — parse and notify
      const tasks = this.markdownToTasks(remoteMd);
      this.lastSyncedContent = remoteMd;
      this.onRemoteChange?.(tasks);
    } catch (error) {
      console.error('Failed to check remote changes:', error);
    }
  }

  /**
   * Start polling for remote changes
   */
  startPolling() {
    if (this.pollTimer) return; // Already polling

    // Do an initial check immediately
    this.checkRemoteChanges();

    this.pollTimer = setInterval(() => {
      this.checkRemoteChanges();
    }, this.pollInterval);
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
   * Test connection to Obsidian Local REST API
   * Tries HTTPS first (port 27124), then falls back to HTTP (port 27123)
   * @returns {Promise<boolean>} True if connection successful
   */
  async testConnection() {
    const urls = ['https://127.0.0.1:27124', 'http://127.0.0.1:27123'];

    for (const url of urls) {
      try {
        const response = await fetch(`${url}/`, {
          headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (response.ok) {
          this.apiUrl = url;
          this.setConnected(true);
          return true;
        }
      } catch {
        // Try next URL
      }
    }

    this.setConnected(false);
    return false;
  }
}
