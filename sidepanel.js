// Sidepanel UI Controller
// Handles all UI interactions and DOM manipulation

// Initialize task manager
const taskManager = new TaskManager();

// DOM elements
let taskListContainer, completedList, completedSection, completedHeader;
let addTaskBtn, emptyState, completedCount;
let settingsBtn, settingsPanel, syncIndicator, syncDot, syncLabel;
let apiKeyInput, vaultPathInput, syncEnabledInput;
let testConnectionBtn, saveSettingsBtn, connectionStatus;

// State
let preferences = { completedSectionExpanded: false };
let saveTimeout = null;

/** @type {ObsidianSync|null} */
let obsidianSync = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  taskListContainer = document.getElementById('task-list-container');
  completedList = document.getElementById('completed-list');
  completedSection = document.getElementById('completed-section');
  completedHeader = document.getElementById('completed-header');
  addTaskBtn = document.getElementById('add-task-btn');
  emptyState = document.getElementById('empty-state');
  completedCount = document.getElementById('completed-count');

  // Settings & sync DOM elements
  settingsBtn = document.getElementById('settings-btn');
  settingsPanel = document.getElementById('settings-panel');
  syncIndicator = document.getElementById('sync-indicator');
  syncDot = document.getElementById('sync-dot');
  syncLabel = document.getElementById('sync-label');
  apiKeyInput = document.getElementById('api-key-input');
  vaultPathInput = document.getElementById('vault-path-input');
  syncEnabledInput = document.getElementById('sync-enabled-input');
  testConnectionBtn = document.getElementById('test-connection-btn');
  saveSettingsBtn = document.getElementById('save-settings-btn');
  connectionStatus = document.getElementById('connection-status');

  // Load data
  await loadData();

  // Setup event listeners
  setupEventListeners();

  // Initialize sync
  await initSync();

  // Initial render
  renderTasks();
});

/**
 * Load tasks and preferences from storage
 */
async function loadData() {
  try {
    const tasks = await storage.getAllTasks();
    taskManager.loadTasks(tasks);

    preferences = await storage.getPreferences();

    // Apply collapsed state
    if (!preferences.completedSectionExpanded) {
      completedSection.classList.add('collapsed');
    }
  } catch (error) {
    console.error('Failed to load data:', error);
    showError('无法加载任务数据');
  }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Add task button
  addTaskBtn.addEventListener('click', handleAddTask);

  // Completed section toggle
  completedHeader.addEventListener('click', toggleCompletedSection);

  // Settings panel toggle
  settingsBtn.addEventListener('click', toggleSettingsPanel);

  // Save settings
  saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Test connection
  testConnectionBtn.addEventListener('click', handleTestConnection);
}

/**
 * Handle add task button click
 */
function handleAddTask() {
  const task = taskManager.createTask('新任务');
  saveTasksDebounced();
  renderTasks();

  // Focus the new task for editing
  setTimeout(() => {
    const taskElement = document.querySelector(`[data-task-id="${task.id}"] .task-content`);
    if (taskElement) {
      taskElement.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(taskElement);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, 100);
}

/**
 * Toggle completed section expanded/collapsed
 */
function toggleCompletedSection() {
  const isCollapsed = completedSection.classList.toggle('collapsed');
  preferences.completedSectionExpanded = !isCollapsed;
  storage.savePreferences(preferences);
}

/**
 * Render all tasks
 */
function renderTasks() {
  const activeTasks = taskManager.getActiveTasks();
  const completedTasks = taskManager.getCompletedTasks();

  // Render active tasks
  taskListContainer.innerHTML = '';
  activeTasks.forEach(task => {
    const taskElement = createTaskElement(task);
    taskListContainer.appendChild(taskElement);
  });

  // Render completed tasks
  completedList.innerHTML = '';
  completedTasks.forEach(task => {
    const taskElement = createTaskElement(task);
    taskElement.classList.add('completed');
    completedList.appendChild(taskElement);
  });

  // Update completed count
  completedCount.textContent = completedTasks.length;

  // Show/hide empty state
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    emptyState.style.display = 'block';
    taskListContainer.style.display = 'none';
    completedSection.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    taskListContainer.style.display = 'block';
    completedSection.style.display = 'block';
  }

  // Setup drag and drop for active tasks
  setupDragAndDrop();
}

/**
 * Create a task DOM element
 * @param {Object} task - Task object
 * @returns {HTMLElement} Task element
 */
function createTaskElement(task) {
  const taskItem = document.createElement('div');
  taskItem.className = 'task-item';
  taskItem.setAttribute('data-task-id', task.id);
  taskItem.setAttribute('draggable', !task.completed);

  // Drag handle (only for active tasks)
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⋮⋮';
  if (task.completed) {
    dragHandle.style.visibility = 'hidden';
  }

  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = 'task-checkbox';
  if (task.completed) {
    checkbox.classList.add('checked');
  }
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    handleToggleComplete(task.id);
  });

  // Priority badge
  const priorityBadge = document.createElement('div');
  priorityBadge.className = 'priority-badge';
  if (task.priority) {
    priorityBadge.classList.add(`priority-${task.priority.toLowerCase()}`);
    priorityBadge.textContent = task.priority;
  } else {
    priorityBadge.classList.add('priority-none');
    priorityBadge.textContent = '—';
  }
  if (!task.completed) {
    priorityBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCyclePriority(task.id);
    });
  }

  // Task content
  const content = document.createElement('div');
  content.className = 'task-content';
  content.textContent = task.content;
  content.setAttribute('contenteditable', !task.completed);

  if (!task.completed) {
    content.addEventListener('blur', (e) => {
      handleContentEdit(task.id, e.target.textContent);
    });
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.textContent = task.content; // Restore original
        e.target.blur();
      }
    });
  }

  // Delete button
  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeleteTask(task.id);
  });

  // Assemble
  taskItem.appendChild(dragHandle);
  taskItem.appendChild(checkbox);
  taskItem.appendChild(priorityBadge);
  taskItem.appendChild(content);
  taskItem.appendChild(deleteBtn);

  return taskItem;
}

/**
 * Setup drag and drop for task reordering
 */
function setupDragAndDrop() {
  const taskItems = taskListContainer.querySelectorAll('.task-item');

  taskItems.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
  });

  taskListContainer.addEventListener('dragover', handleDragOver);
}

/**
 * Handle drag start
 */
function handleDragStart(e) {
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

/**
 * Handle drag end
 */
function handleDragEnd(e) {
  e.target.classList.remove('dragging');

  // Update task orders based on DOM order
  const taskElements = taskListContainer.querySelectorAll('.task-item');
  taskElements.forEach((el, index) => {
    const taskId = el.getAttribute('data-task-id');
    taskManager.reorderTasks(taskId, index);
  });

  taskManager.normalizeOrders();
  saveTasksDebounced();
}

/**
 * Handle drag over
 */
function handleDragOver(e) {
  e.preventDefault();
  const dragging = taskListContainer.querySelector('.dragging');
  const afterElement = getDragAfterElement(taskListContainer, e.clientY);

  if (afterElement == null) {
    taskListContainer.appendChild(dragging);
  } else {
    taskListContainer.insertBefore(dragging, afterElement);
  }
}

/**
 * Get the element after which to insert the dragged element
 */
function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll('.task-item:not(.dragging)')
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

/**
 * Handle toggle complete
 */
function handleToggleComplete(taskId) {
  taskManager.toggleComplete(taskId);
  saveTasksDebounced();
  renderTasks();
}

/**
 * Handle cycle priority
 */
function handleCyclePriority(taskId) {
  taskManager.cyclePriority(taskId);
  saveTasksDebounced();
  renderTasks();
}

/**
 * Handle content edit
 */
function handleContentEdit(taskId, newContent) {
  const trimmedContent = newContent.trim();
  if (trimmedContent && trimmedContent !== taskManager.tasks.find(t => t.id === taskId).content) {
    taskManager.updateTask(taskId, { content: trimmedContent });
    saveTasksDebounced();
  }
  renderTasks();
}

/**
 * Handle delete task
 */
function handleDeleteTask(taskId) {
  const taskElement = document.querySelector(`[data-task-id="${taskId}"]`);
  if (taskElement) {
    taskElement.classList.add('removing');
    setTimeout(() => {
      taskManager.deleteTask(taskId);
      saveTasksDebounced();
      renderTasks();
    }, 250);
  }
}

/**
 * Save tasks with debouncing (300ms)
 * Also syncs to Obsidian if sync is enabled
 */
function saveTasksDebounced() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  // Mark that we have pending local changes (prevents remote overwrite during active editing)
  if (obsidianSync) {
    obsidianSync.pendingLocalChanges = true;
  }

  saveTimeout = setTimeout(async () => {
    try {
      const allTasks = taskManager.getAllTasks();
      // Save to chrome.storage.local (always, as cache/fallback)
      await storage.saveTasks(allTasks);
      // Sync to Obsidian if connected
      if (obsidianSync?.connected) {
        await obsidianSync.syncToRemote(allTasks);
      }
    } catch (error) {
      console.error('Failed to save tasks:', error);
      showError('保存失败，请重试');
    }
  }, 300);
}

/**
 * Show error message
 */
function showError(message) {
  // Simple error notification (could be enhanced with a toast system)
  console.error(message);
  alert(message);
}

// ─── Obsidian Sync Integration ───

/**
 * Initialize Obsidian sync from saved configuration
 */
async function initSync() {
  try {
    const syncConfig = await storage.getSyncConfig();

    // Populate settings form
    syncEnabledInput.checked = syncConfig.syncEnabled;
    apiKeyInput.value = syncConfig.apiKey;
    vaultPathInput.value = syncConfig.vaultPath;

    if (syncConfig.syncEnabled && syncConfig.apiKey) {
      obsidianSync = new ObsidianSync(syncConfig);
      obsidianSync.onRemoteChange = handleRemoteChange;
      obsidianSync.onConnectionChange = updateSyncIndicator;

      // Show sync indicator
      syncIndicator.style.display = 'flex';

      // Test connection first (determines HTTPS vs HTTP URL)
      const connected = await obsidianSync.testConnection();
      if (connected) {
        // Try initial sync: load from remote if available
        const remoteMd = await obsidianSync.readRemoteFile();
        if (remoteMd) {
          const remoteTasks = obsidianSync.markdownToTasks(remoteMd);
          obsidianSync.lastSyncedContent = remoteMd;
          taskManager.loadFromParsedTasks(remoteTasks);
          await storage.saveTasks(taskManager.getAllTasks());
        } else {
          // Connected but no file yet — push current tasks to create the file
          await obsidianSync.syncToRemote(taskManager.getAllTasks());
        }

        // Start polling for changes
        obsidianSync.startPolling();
      }
    }
  } catch (error) {
    console.error('Failed to initialize sync:', error);
  }
}

/**
 * Handle remote changes detected by polling
 * @param {Array} remoteTasks - Tasks parsed from remote markdown
 */
function handleRemoteChange(remoteTasks) {
  taskManager.loadFromParsedTasks(remoteTasks);
  renderTasks();
  // Update local cache
  storage.saveTasks(taskManager.getAllTasks());
}

/**
 * Update sync status indicator
 * @param {boolean} connected
 */
function updateSyncIndicator(connected) {
  if (!syncIndicator) return;

  syncIndicator.style.display = 'flex';

  if (connected) {
    syncDot.className = 'sync-dot connected';
    syncLabel.textContent = '已同步';
  } else {
    syncDot.className = 'sync-dot';
    syncLabel.textContent = '离线';
  }
}

/**
 * Toggle settings panel visibility
 */
function toggleSettingsPanel() {
  const isHidden = settingsPanel.style.display === 'none';
  settingsPanel.style.display = isHidden ? 'block' : 'none';
  // Hide connection status when toggling
  connectionStatus.style.display = 'none';
}

/**
 * Handle save settings button click
 */
async function handleSaveSettings() {
  const syncConfig = {
    syncEnabled: syncEnabledInput.checked,
    apiKey: apiKeyInput.value.trim(),
    vaultPath: vaultPathInput.value.trim() || '0. 目标及计划/Daily',
    pollInterval: 3000
  };

  try {
    await storage.saveSyncConfig(syncConfig);

    // Stop existing sync if running
    if (obsidianSync) {
      obsidianSync.stopPolling();
      obsidianSync = null;
    }

    // Restart sync with new config
    if (syncConfig.syncEnabled && syncConfig.apiKey) {
      obsidianSync = new ObsidianSync(syncConfig);
      obsidianSync.onRemoteChange = handleRemoteChange;
      obsidianSync.onConnectionChange = updateSyncIndicator;
      syncIndicator.style.display = 'flex';

      // Test connection first, then push current tasks
      const connected = await obsidianSync.testConnection();
      if (connected) {
        await obsidianSync.syncToRemote(taskManager.getAllTasks());
        obsidianSync.startPolling();
      }
    } else {
      syncIndicator.style.display = 'none';
    }

    // Close settings panel
    settingsPanel.style.display = 'none';
  } catch (error) {
    console.error('Failed to save settings:', error);
    showError('设置保存失败');
  }
}

/**
 * Handle test connection button click
 */
async function handleTestConnection() {
  const apiKey = apiKeyInput.value.trim();
  const vaultPath = vaultPathInput.value.trim() || '0. 目标及计划/Daily';

  if (!apiKey) {
    connectionStatus.textContent = '请输入 API Key';
    connectionStatus.className = 'connection-status error';
    connectionStatus.style.display = 'block';
    return;
  }

  connectionStatus.textContent = '测试中...';
  connectionStatus.className = 'connection-status';
  connectionStatus.style.display = 'block';

  const testSync = new ObsidianSync({ apiKey, vaultPath });
  const connected = await testSync.testConnection();

  if (connected) {
    connectionStatus.textContent = '连接成功！Obsidian Local REST API 已响应';
    connectionStatus.className = 'connection-status success';
  } else {
    connectionStatus.textContent = '连接失败。请确认 Obsidian 正在运行且 Local REST API 插件已启用';
    connectionStatus.className = 'connection-status error';
  }
}
