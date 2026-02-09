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
            syncEnabled: false,
            pollInterval: 3000
          });
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
  }
};
