// Background service worker for Tasksboard extension
// Handles side panel opening, initialization, and daily task rollover

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
 * Get today's date in ISO format (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate unique ID for tasks
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Execute daily rollover: copy yesterday's incomplete tasks to today
 * @returns {Promise<boolean>} True if rollover was performed
 */
async function executeRollover() {
  try {
    const today = getTodayDate();

    // Guard: check if already rolled over today
    const result = await chrome.storage.local.get(['lastRolloverDate', 'tasks']);
    const lastRolloverDate = result.lastRolloverDate || null;
    const tasks = result.tasks || [];

    if (lastRolloverDate === today) {
      console.log('[Rollover] Already executed today, skipping');
      return false;
    }

    // Guard: check if today already has tasks
    const todaysTasks = tasks.filter(t => t.createdAt === today);
    if (todaysTasks.length > 0) {
      console.log('[Rollover] Today already has tasks, skipping');
      // Still mark as done so we don't check again
      await chrome.storage.local.set({ lastRolloverDate: today });
      return false;
    }

    // Find the most recent date that has tasks
    const dates = [...new Set(tasks.map(t => t.createdAt))].sort().reverse();
    if (dates.length === 0) {
      console.log('[Rollover] No historical tasks found');
      await chrome.storage.local.set({ lastRolloverDate: today });
      return false;
    }

    const mostRecentDate = dates[0];
    const incompleteTasks = tasks.filter(
      t => t.createdAt === mostRecentDate && !t.completed
    );

    if (incompleteTasks.length === 0) {
      console.log('[Rollover] No incomplete tasks from', mostRecentDate);
      await chrome.storage.local.set({ lastRolloverDate: today });
      return false;
    }

    // Copy incomplete tasks with new IDs and today's date
    const newTasks = incompleteTasks.map((task, index) => ({
      id: generateId(),
      content: task.content,
      priority: task.priority,
      completed: false,
      order: index,
      createdAt: today,
      completedAt: null
    }));

    const updatedTasks = [...tasks, ...newTasks];
    await chrome.storage.local.set({
      tasks: updatedTasks,
      lastRolloverDate: today
    });

    console.log(`[Rollover] Copied ${newTasks.length} tasks from ${mostRecentDate} to ${today}`);

    // Notify sidepanel to refresh
    chrome.runtime.sendMessage({ type: 'rollover-complete', count: newTasks.length }).catch(() => {
      // Sidepanel may not be open — that's fine
    });

    return true;
  } catch (error) {
    console.error('[Rollover] Error:', error);
    return false;
  }
}

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    executeRollover();
    // Reschedule for next midnight (in case periodInMinutes drifts)
    scheduleMidnightAlarm();
  }
});

// Listen for messages from sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'check-rollover') {
    executeRollover().then((performed) => {
      sendResponse({ performed });
    });
    return true; // Keep message channel open for async response
  }
});
