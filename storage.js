// Storage abstraction layer for chrome.storage.local API
// Provides Promise-based interface for data persistence

const storage = {
  /**
   * Get all tasks from storage
   * @returns {Promise<Array>} Array of task objects
   */
  async getAllTasks() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['tasks'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.tasks || []);
        }
      });
    });
  },

  /**
   * Save tasks to storage
   * @param {Array} tasks - Array of task objects
   * @returns {Promise<void>}
   */
  async saveTasks(tasks) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ tasks }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Get user preferences from storage
   * @returns {Promise<Object>} Preferences object
   */
  async getPreferences() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['preferences'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.preferences || { completedSectionExpanded: false });
        }
      });
    });
  },

  /**
   * Save user preferences to storage
   * @param {Object} preferences - Preferences object
   * @returns {Promise<void>}
   */
  async savePreferences(preferences) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ preferences }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Get sync configuration
   * @returns {Promise<Object>} Sync config object
   */
  async getSyncConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['syncConfig'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.syncConfig || {
            apiKey: '',
            vaultPath: '0. 目标及计划/Daily',
            todoFilePath: '9. To-do List/Todo_List.md',
            syncEnabled: false,
            pollInterval: 3000
          });
        }
      });
    });
  },

  /**
   * Get last rollover date
   * @returns {Promise<string|null>} Date string (YYYY-MM-DD) or null
   */
  async getLastRolloverDate() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['lastRolloverDate'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.lastRolloverDate || null);
        }
      });
    });
  },

  /**
   * Save last rollover date
   * @param {string} dateStr - Date string (YYYY-MM-DD)
   * @returns {Promise<void>}
   */
  async setLastRolloverDate(dateStr) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ lastRolloverDate: dateStr }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Save sync configuration
   * @param {Object} syncConfig - Sync config object
   * @returns {Promise<void>}
   */
  async saveSyncConfig(syncConfig) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ syncConfig }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Get todo list data from storage
   * @returns {Promise<Object>} Todo data with preamble and sections
   */
  async getTodoData() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['todoData'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.todoData || { preamble: '', sections: [] });
        }
      });
    });
  },

  /**
   * Save todo list data to storage
   * @param {Object} todoData - Todo data with preamble and sections
   * @returns {Promise<void>}
   */
  async saveTodoData(todoData) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ todoData }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  },

  /**
   * Get completion history from storage
   * @returns {Promise<Object>} Completion history object with dates as keys
   */
  async getCompletionHistory() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['completionHistory'], (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r.completionHistory || {});
      });
    });
  },

  /**
   * Save completion record for a specific date
   * @param {string} dateStr - Date string (YYYY-MM-DD)
   * @param {Object} record - Completion record object
   * @returns {Promise<void>}
   */
  async saveCompletionDay(dateStr, record) {
    const history = await this.getCompletionHistory();
    history[dateStr] = record;
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ completionHistory: history }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },

  /**
   * Get today extra items from storage
   * @param {string} dateStr - Current date string (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of extra items if date matches, empty array otherwise
   */
  async getTodayExtra(dateStr) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['todayExtra'], (r) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else {
          const te = r.todayExtra;
          resolve(te && te.date === dateStr ? te.items : []);
        }
      });
    });
  },

  /**
   * Add an item to today extra list (with deduplication)
   * @param {string} dateStr - Current date string (YYYY-MM-DD)
   * @param {string} text - Extra item text
   * @returns {Promise<void>}
   */
  async addTodayExtra(dateStr, text) {
    const items = await this.getTodayExtra(dateStr);
    if (!items.includes(text)) items.push(text);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ todayExtra: { date: dateStr, items } }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  },

  /**
   * Clear today extra items
   * @returns {Promise<void>}
   */
  async clearTodayExtra() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ todayExtra: { date: null, items: [] } }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  }
};
