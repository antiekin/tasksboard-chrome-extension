// Background service worker for Tasksboard extension
// Handles side panel opening and initialization

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
});
