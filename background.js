// Background service worker for Tasksboard extension
// Handles side panel opening, midnight archive alarm, and initialization

const ALARM_NAME = 'daily-rollover';

chrome.action.onClicked.addListener((tab) => {
  // Open the side panel when extension icon is clicked
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Initialize default preferences on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['tasks', 'preferences'], (result) => {
    if (!result.tasks) {
      chrome.storage.local.set({ tasks: [] });
    }
    if (!result.preferences) {
      chrome.storage.local.set({
        preferences: {
          completedSectionExpanded: false
        }
      });
    }
  });

  // Schedule midnight alarm on install/update
  scheduleMidnightAlarm();
});

// Also schedule alarm when service worker starts (e.g. after browser restart)
scheduleMidnightAlarm();

// ─── Daily Rollover ───

/**
 * Schedule an alarm for the next midnight (00:00:05)
 */
function scheduleMidnightAlarm() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 5, 0); // 00:00:05

  const delayInMinutes = (nextMidnight.getTime() - now.getTime()) / 60000;

  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: delayInMinutes,
    periodInMinutes: 24 * 60 // repeat daily
  });
}

/**
 * Get today's date in local timezone (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate unique ID for tasks
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    const yesterday = (() => {
      const dt = new Date();
      dt.setDate(dt.getDate() - 1);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();
    chrome.runtime.sendMessage({ type: 'daily-archive', date: yesterday }).catch(() => {});
    // Reschedule for next midnight (in case periodInMinutes drifts)
    scheduleMidnightAlarm();
  }
});

