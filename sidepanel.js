// Sidepanel UI Controller
// Handles all UI interactions and DOM manipulation

// Initialize task manager
const taskManager = new TaskManager();

// DOM elements
let taskListContainer, completedList, completedSection, completedHeader;
let addTaskBtn, emptyState, completedCount;
let settingsBtn, settingsPanel, syncIndicator, syncDot, syncLabel;
let apiKeyInput, vaultPathInput, syncEnabledInput, todoFilePathInput;
let testConnectionBtn, saveSettingsBtn, connectionStatus;

// State
let preferences = { completedSectionExpanded: false };
let saveTimeout = null;

/** @type {ObsidianSync|null} */
let obsidianSync = null;

/** @type {TodoSync|null} */
let todoSync = null;
let todoData = { preamble: '', sections: [] };
let todoSaveTimeout = null;

// Category definitions
const CATEGORIES = ['家庭', '工作', '健康', '学习', null];

/**
 * Create a category tag DOM element
 * @param {string|null} category - Current category
 * @param {function} onClick - Click handler
 * @returns {HTMLElement}
 */
function createCategoryTag(category, onClick) {
  const tag = document.createElement('span');
  tag.className = 'category-tag';
  if (category) {
    tag.classList.add(`category-${category}`);
    tag.textContent = category;
  } else {
    tag.classList.add('category-none');
    tag.textContent = '\u00B7';
  }
  tag.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return tag;
}

// ─── Today Page Helpers ───

/**
 * Get today's date as local YYYY-MM-DD string
 * @returns {string}
 */
function getLocalToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Render the Today (必做) page
 */
function renderToday() {
  const listEl = document.getElementById('must-do-list');
  const emptyEl = document.getElementById('today-empty');
  if (!listEl || !emptyEl) return;

  const mustDo = getMustDoItems(todoData);   // from daily-focus.js
  listEl.innerHTML = '';
  emptyEl.style.display = mustDo.length === 0 ? 'block' : 'none';

  for (const item of mustDo) {
    const card = document.createElement('div');
    card.className = 'mustdo-card' + (item.completed ? ' done' : '');

    const check = document.createElement('span');
    check.className = 'check';
    check.addEventListener('click', () => completeMustDoItem(item.id));

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;   // textContent prevents XSS

    card.appendChild(check);
    card.appendChild(text);

    if (item.category) {
      const tag = createCategoryTag(item.category, () => {});
      tag.style.cursor = 'default';
      card.appendChild(tag);
    }

    listEl.appendChild(card);
  }

  const done = mustDo.filter(i => i.completed).length;
  const mdDoneEl = document.getElementById('md-done');
  const mdTotalEl = document.getElementById('md-total');
  if (mdDoneEl) mdDoneEl.textContent = done;
  if (mdTotalEl) mdTotalEl.textContent = mustDo.length;

  // Streak display — refreshStreakMini defined by Task 11; stub if absent
  if (typeof refreshStreakMini === 'function') refreshStreakMini();

  // Hide celebration and board when not all must-do items are complete
  if (!allMustDoComplete(todoData)) {
    document.getElementById('celebrate').style.display = 'none';
    document.getElementById('board').style.display = 'none';
  }
}

/**
 * Find a todo item by id across all sections
 * @param {string} id
 * @returns {Object|null}
 */
function findTodoItem(id) {
  for (const s of todoData.sections) {
    const it = s.items.find(i => i.id === id);
    if (it) return it;
  }
  return null;
}

/**
 * Mark a must-do item as completed
 * @param {string} id - Todo item id
 */
async function completeMustDoItem(id) {
  const item = findTodoItem(id);
  if (!item || item.completed) return;
  item.completed = true;
  saveTodoDebounced();
  renderToday();
  // triggerCompletionFx and showAllDoneCelebration defined by Tasks 11/12; stub if absent
  if (typeof triggerCompletionFx === 'function') triggerCompletionFx(false);
  if (allMustDoComplete(todoData) && typeof showAllDoneCelebration === 'function') {
    showAllDoneCelebration();
  }
}

/**
 * Archive the day: save completion record, write Obsidian log, reset today flags
 * @param {string} dateStr - YYYY-MM-DD date to archive
 */
async function handleDailyArchive(dateStr) {
  try {
    const extra = await storage.getTodayExtra(dateStr);
    const mustDo = getMustDoItems(todoData).map(i => ({ text: i.text, completed: i.completed }));
    const record = buildDayRecord(todoData, extra);
    await storage.saveCompletionDay(dateStr, record);
    if (obsidianSync && obsidianSync.connected) {
      await obsidianSync.writeDailyLog(dateStr, mustDo, record.overAchieved);
    }
    // Clear #今日 flags across all sections
    for (const s of todoData.sections) {
      for (const it of s.items) it.today = false;
    }
    saveTodoDebounced();
    await storage.clearTodayExtra();
    renderToday();
  } catch (error) {
    console.error('Failed to handle daily archive:', error);
  }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements (non-daily-tab elements may be null after HTML restructure)
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
  todoFilePathInput = document.getElementById('todo-file-path-input');
  testConnectionBtn = document.getElementById('test-connection-btn');
  saveSettingsBtn = document.getElementById('save-settings-btn');
  connectionStatus = document.getElementById('connection-status');

  // Load data
  await loadData();

  // Setup event listeners and tab switching
  setupEventListeners();
  setupTabSwitching();

  // Initialize sync (daily + todo)
  await initSync();

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'daily-archive') {
      handleDailyArchive(message.date).then(() => {
        storage.setLastRolloverDate(getLocalToday());
      });
    }
  });

  // Startup catch-up: if sidepanel was closed at midnight, archive the missed day now
  try {
    const today = getLocalToday();
    const last = await storage.getLastRolloverDate();
    if (last && last !== today) {
      await handleDailyArchive(last);
    }
    await storage.setLastRolloverDate(today);
  } catch (err) {
    console.error('Startup catch-up failed:', err);
  }

  // Initial render
  renderTodoSections();
  renderToday();

  // Initialise streak mini-display after today is rendered (Task 14)
  if (typeof refreshStreakMini === 'function') refreshStreakMini();
});

/**
 * Load tasks and preferences from storage
 */
async function loadData() {
  try {
    const tasks = await storage.getAllTasks();
    taskManager.loadTasks(tasks);

    preferences = await storage.getPreferences();
    todoData = await storage.getTodoData();

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
  // Add task button (may be absent after daily-tab restructure)
  if (addTaskBtn) addTaskBtn.addEventListener('click', handleAddTask);

  // Completed section toggle (may be absent after daily-tab restructure)
  if (completedHeader) completedHeader.addEventListener('click', toggleCompletedSection);

  // Settings panel toggle
  if (settingsBtn) settingsBtn.addEventListener('click', toggleSettingsPanel);

  // Save settings
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Test connection
  if (testConnectionBtn) testConnectionBtn.addEventListener('click', handleTestConnection);

  // Temporary must-do add button — prompt for text then addTempMustDo (Task 15)
  const addMustdoBtn = document.getElementById('add-mustdo-btn');
  if (addMustdoBtn) {
    addMustdoBtn.addEventListener('click', () => {
      const text = prompt('新增今日必做：');
      if (text && text.trim()) {
        addTempMustDo(text);
      }
    });
  }
}

/**
 * Setup tab switching
 */
function setupTabSwitching() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');

      // Re-render today page whenever user switches to the daily tab
      if (tab.dataset.tab === 'daily') {
        renderToday();
      }
    });
  });
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

  // Category tag
  const categoryTag = createCategoryTag(task.category, () => handleCycleCategory(task.id));

  // Move to todo button
  const moveBtn = document.createElement('div');
  moveBtn.className = 'move-btn';
  moveBtn.textContent = '↩';
  moveBtn.title = '移到待办清单';
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleMoveToTodo(task.id);
  });

  // Assemble
  taskItem.appendChild(dragHandle);
  taskItem.appendChild(checkbox);
  taskItem.appendChild(priorityBadge);
  taskItem.appendChild(content);
  taskItem.appendChild(categoryTag);
  taskItem.appendChild(moveBtn);
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
 * Handle cycle category for daily tasks
 */
function handleCycleCategory(taskId) {
  const task = taskManager.tasks.find(t => t.id === taskId);
  if (!task) return;
  const index = CATEGORIES.indexOf(task.category);
  task.category = CATEGORIES[(index + 1) % CATEGORIES.length];
  taskManager.lastModifiedAt = Date.now();
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
    todoFilePathInput.value = syncConfig.todoFilePath || '9. To-do List/Todo_List.md';

    if (syncConfig.syncEnabled && syncConfig.apiKey) {
      obsidianSync = new ObsidianSync(syncConfig);
      obsidianSync.onRemoteChange = handleRemoteChange;
      obsidianSync.onConnectionChange = updateSyncIndicator;

      // Show sync indicator
      syncIndicator.style.display = 'flex';

      // Test connection first (determines HTTPS vs HTTP URL, and validates the key)
      const result = await obsidianSync.testConnection();
      if (result.ok) {
        // Try initial sync: load from remote if available
        const remoteMd = await obsidianSync.readRemoteFile();
        if (remoteMd) {
          const remoteTasks = obsidianSync.markdownToTasks(remoteMd);
          obsidianSync.lastSyncedContent = remoteMd;
          const localTasks = taskManager.getAllTasks();
          const matchedTasks = obsidianSync.matchRemoteToLocal(remoteTasks, localTasks);
          taskManager.loadFromParsedTasks(matchedTasks);
          await storage.saveTasks(taskManager.getAllTasks());
        } else {
          // Connected but no file yet — push current tasks to create the file
          await obsidianSync.syncToRemote(taskManager.getAllTasks());
        }

        // Start polling for changes
        obsidianSync.startPolling();

        // Init todo sync using the same connection
        await initTodoSync(syncConfig, obsidianSync.apiUrl);
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
  const localTasks = taskManager.getAllTasks();
  const matchedTasks = obsidianSync.matchRemoteToLocal(remoteTasks, localTasks);
  taskManager.loadFromParsedTasks(matchedTasks);
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
    // Strip an accidental "Bearer " prefix so storage keeps a clean key.
    apiKey: apiKeyInput.value.trim().replace(/^Bearer\s+/i, ''),
    vaultPath: vaultPathInput.value.trim() || '0. 目标及计划/Daily',
    todoFilePath: todoFilePathInput.value.trim() || '9. To-do List/Todo_List.md',
    pollInterval: 3000
  };

  // 1) Persist the config first. This IS the "save"; keep it independent so a
  //    later sync hiccup never reads as "config not saved".
  try {
    await storage.saveSyncConfig(syncConfig);
  } catch (error) {
    console.error('Failed to save sync config:', error);
    showError('配置保存失败,请重试');
    return;
  }

  // Stop any existing sync before reconfiguring
  if (obsidianSync) {
    obsidianSync.stopPolling();
    obsidianSync = null;
  }
  if (todoSync) {
    todoSync.stopPolling();
    todoSync = null;
  }

  // Sync disabled (or no key): config saved, nothing else to do.
  if (!syncConfig.syncEnabled || !syncConfig.apiKey) {
    syncIndicator.style.display = 'none';
    settingsPanel.style.display = 'none';
    return;
  }

  // 2) Bring up the connection. Failures here do NOT undo the saved config —
  //    report the specific reason instead of a generic "save failed".
  obsidianSync = new ObsidianSync(syncConfig);
  obsidianSync.onRemoteChange = handleRemoteChange;
  obsidianSync.onConnectionChange = updateSyncIndicator;
  syncIndicator.style.display = 'flex';

  const result = await obsidianSync.testConnection();
  if (!result.ok) {
    showError('配置已保存,但同步未连接:' + describeSyncError(result.reason));
    settingsPanel.style.display = 'none';
    return;
  }

  // 3) Initial push + start polling. Surface the HTTP status if the push fails.
  try {
    await obsidianSync.syncToRemote(taskManager.getAllTasks());
    obsidianSync.startPolling();
    await initTodoSync(syncConfig, obsidianSync.apiUrl);
    settingsPanel.style.display = 'none';
  } catch (error) {
    console.error('Initial sync push failed:', error);
    showError('配置已保存,但首次同步失败:' + describeSyncError(error));
  }
}

/**
 * Turn a sync failure (testConnection reason or thrown error) into a user-facing hint.
 * @param {string|Error} reasonOrError - 'unauthorized'/'offline' or a thrown Error
 * @returns {string}
 */
function describeSyncError(reasonOrError) {
  const text = typeof reasonOrError === 'string' ? reasonOrError : (reasonOrError?.message || '');
  if (reasonOrError === 'unauthorized' || /\b401\b/.test(text)) {
    return 'API Key 无效(401)。请填入纯 key,不要带 "Bearer " 前缀或多余空格';
  }
  if (reasonOrError === 'offline') {
    return 'Obsidian 未响应。请确认 Obsidian 正在运行,且 Local REST API 插件已启用';
  }
  if (/\b404\b/.test(text)) {
    return '路径不存在(404)。请检查「Daily Tasks 文件夹」是否为正确的 vault 相对路径';
  }
  return text || '未知错误';
}

/**
 * Handle test connection button click
 */
async function handleTestConnection() {
  const apiKey = apiKeyInput.value.trim().replace(/^Bearer\s+/i, '');
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
  const result = await testSync.testConnection();

  if (result.ok) {
    connectionStatus.textContent = '连接成功!API Key 有效,可以保存了';
    connectionStatus.className = 'connection-status success';
  } else if (result.reason === 'unauthorized') {
    connectionStatus.textContent = 'API Key 无效(401)。请填入纯 key,不要带 "Bearer " 前缀';
    connectionStatus.className = 'connection-status error';
  } else {
    connectionStatus.textContent = '连接失败。请确认 Obsidian 正在运行且 Local REST API 插件已启用';
    connectionStatus.className = 'connection-status error';
  }
}

// ─── Todo List Tab ───

/**
 * Initialize todo sync using an already-connected Obsidian instance
 * @param {Object} syncConfig - Sync configuration
 * @param {string} apiUrl - Verified API URL from obsidianSync
 */
async function initTodoSync(syncConfig, apiUrl) {
  try {
    todoSync = new TodoSync({
      apiUrl: apiUrl,
      apiKey: syncConfig.apiKey,
      todoFilePath: syncConfig.todoFilePath || '9. To-do List/Todo_List.md',
      pollInterval: syncConfig.pollInterval || 3000
    });

    todoSync.onRemoteChange = handleTodoRemoteChange;
    todoSync.connected = true;

    // Initial load from remote
    const remoteMd = await todoSync.readRemoteFile();
    if (remoteMd) {
      const remoteData = todoSync.parseTodoMarkdown(remoteMd);
      todoSync.lastSyncedContent = remoteMd;
      todoData = todoSync.matchRemoteToLocal(remoteData, todoData);
      await storage.saveTodoData(todoData);
      renderTodoSections();
    }

    todoSync.startPolling();
  } catch (error) {
    console.error('Failed to initialize todo sync:', error);
  }
}

/**
 * Handle remote changes to the todo file
 * @param {Object} remoteData - Parsed todo data from remote
 */
function handleTodoRemoteChange(remoteData) {
  todoData = todoSync.matchRemoteToLocal(remoteData, todoData);
  renderTodoSections();
  renderToday();
  storage.saveTodoData(todoData);
}

/**
 * Render all todo sections
 */
function renderTodoSections() {
  const container = document.getElementById('todo-sections-container');
  if (!container) return;
  container.innerHTML = '';

  if (!todoData.sections || todoData.sections.length === 0) {
    container.innerHTML = '<div class="todo-empty-hint">尚未加载 To-do List 数据</div>';
    return;
  }

  for (const section of todoData.sections) {
    const sectionEl = createTodoSectionElement(section);
    container.appendChild(sectionEl);
  }

  setupTodoDragAndDrop();
}

/**
 * Create a todo section DOM element
 * @param {Object} section - Section object { name, comment, items }
 * @returns {HTMLElement}
 */
function createTodoSectionElement(section) {
  const sectionEl = document.createElement('div');
  sectionEl.className = 'todo-section';

  // Header
  const header = document.createElement('div');
  header.className = 'todo-section-header';

  const title = document.createElement('span');
  title.className = 'todo-section-title';
  title.textContent = section.name;

  const addBtn = document.createElement('button');
  addBtn.className = 'todo-add-btn';
  addBtn.textContent = '+';
  addBtn.title = '添加任务';
  addBtn.addEventListener('click', () => handleTodoAdd(section.name));

  header.appendChild(title);
  header.appendChild(addBtn);
  sectionEl.appendChild(header);

  // Items container
  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'todo-items-container';
  itemsContainer.setAttribute('data-section', section.name);

  const sortedItems = [...section.items].sort((a, b) => a.order - b.order);
  for (const item of sortedItems) {
    const itemEl = createTodoItemElement(item, section.name);
    itemsContainer.appendChild(itemEl);
  }

  sectionEl.appendChild(itemsContainer);
  return sectionEl;
}

/**
 * Create a todo item DOM element
 * @param {Object} item - Todo item { id, text, reference, completed, order }
 * @param {string} sectionName - Parent section name
 * @returns {HTMLElement}
 */
function createTodoItemElement(item, sectionName) {
  const itemEl = document.createElement('div');
  itemEl.className = 'task-item';
  if (item.completed) itemEl.classList.add('completed');
  itemEl.setAttribute('data-todo-id', item.id);
  itemEl.setAttribute('draggable', !item.completed);

  // Drag handle
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.textContent = '⋮⋮';
  if (item.completed) dragHandle.style.visibility = 'hidden';

  // Checkbox — pool items use completePoolItem to hook over-achieve path (Task 13/15)
  const checkbox = document.createElement('div');
  checkbox.className = 'task-checkbox';
  if (item.completed) checkbox.classList.add('checked');
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!item.completed) {
      completePoolItem(item.id);
    }
  });

  // Priority badge
  const priorityBadge = document.createElement('div');
  priorityBadge.className = 'priority-badge';
  if (item.priority) {
    priorityBadge.classList.add(`priority-${item.priority.toLowerCase()}`);
    priorityBadge.textContent = item.priority;
  } else {
    priorityBadge.classList.add('priority-none');
    priorityBadge.textContent = '—';
  }
  if (!item.completed) {
    priorityBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      handleTodoCyclePriority(sectionName, item.id);
    });
  }

  // Content
  const content = document.createElement('div');
  content.className = 'task-content';
  content.textContent = item.text;
  content.setAttribute('contenteditable', !item.completed);

  if (!item.completed) {
    content.addEventListener('blur', (e) => {
      handleTodoEdit(sectionName, item.id, e.target.textContent);
    });
    content.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.textContent = item.text;
        e.target.blur();
      }
    });
  }

  // Category tag
  const categoryTag = createCategoryTag(item.category, () => handleTodoCycleCategory(sectionName, item.id));

  // Set-as-must-do button (🎯) — only for incomplete, non-today pool items
  let mustdoBtn = null;
  if (!item.completed && !item.today) {
    mustdoBtn = document.createElement('button');
    mustdoBtn.className = 'set-mustdo-btn';
    mustdoBtn.textContent = '\u{1F3AF}';
    mustdoBtn.title = '设为今日必做';
    mustdoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setMustDo(item.id);
    });
  }

  // Move button with dropdown
  const moveBtn = document.createElement('div');
  moveBtn.className = 'move-btn';
  moveBtn.textContent = '↗';
  moveBtn.title = '移动到…';
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showMoveMenu(moveBtn, sectionName, item.id);
  });

  // Delete button
  const deleteBtn = document.createElement('div');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTodoDelete(sectionName, item.id);
  });

  // Assemble
  itemEl.appendChild(dragHandle);
  itemEl.appendChild(checkbox);
  itemEl.appendChild(priorityBadge);
  itemEl.appendChild(content);
  itemEl.appendChild(categoryTag);

  // Reference icon with tooltip (if exists)
  if (item.reference) {
    const refIcon = document.createElement('span');
    refIcon.className = 'todo-reference';
    refIcon.textContent = '🔗';

    const tooltip = document.createElement('span');
    tooltip.className = 'todo-ref-tooltip';
    tooltip.textContent = TodoSync.getRefDisplay(item.reference);
    refIcon.appendChild(tooltip);

    // Position tooltip on hover
    refIcon.addEventListener('mouseenter', () => {
      const rect = refIcon.getBoundingClientRect();
      tooltip.style.top = `${rect.top - 28}px`;
      tooltip.style.left = `${rect.left}px`;
    });

    itemEl.appendChild(refIcon);
  }

  if (mustdoBtn) itemEl.appendChild(mustdoBtn);
  itemEl.appendChild(moveBtn);
  itemEl.appendChild(deleteBtn);

  return itemEl;
}

/**
 * Setup drag and drop for todo items within sections
 */
function setupTodoDragAndDrop() {
  const containers = document.querySelectorAll('.todo-items-container');
  containers.forEach(container => {
    const items = container.querySelectorAll('.task-item:not(.completed)');
    items.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', (e) => {
        e.target.classList.remove('dragging');
        const sectionName = container.getAttribute('data-section');
        const section = todoData.sections.find(s => s.name === sectionName);
        if (!section) return;

        const itemEls = container.querySelectorAll('.task-item');
        itemEls.forEach((el, index) => {
          const id = el.getAttribute('data-todo-id');
          const sItem = section.items.find(i => i.id === id);
          if (sItem) sItem.order = index;
        });

        saveTodoDebounced();
      });
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = container.querySelector('.dragging');
      if (!dragging) return;
      const afterElement = getTodoDragAfterElement(container, e.clientY);
      if (afterElement == null) {
        container.appendChild(dragging);
      } else {
        container.insertBefore(dragging, afterElement);
      }
    });
  });
}

/**
 * Get the element after which to insert during todo drag
 * @param {HTMLElement} container
 * @param {number} y - Mouse Y position
 * @returns {HTMLElement|undefined}
 */
function getTodoDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Handle adding a new todo item to a section
 * @param {string} sectionName
 */
function handleTodoAdd(sectionName) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;

  const newItem = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    text: '新任务',
    reference: null,
    priority: null,
    category: null,
    completed: false,
    order: section.items.length
  };
  section.items.push(newItem);
  saveTodoDebounced();
  renderTodoSections();

  // Focus the new item for editing
  setTimeout(() => {
    const el = document.querySelector(`[data-todo-id="${newItem.id}"] .task-content`);
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 100);
}

/**
 * Handle toggling a todo item's completed state
 * @param {string} sectionName
 * @param {string} itemId
 */
function handleTodoToggle(sectionName, itemId) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;
  const item = section.items.find(i => i.id === itemId);
  if (!item) return;

  item.completed = !item.completed;
  saveTodoDebounced();
  renderTodoSections();
}

/**
 * Handle editing a todo item's text
 * @param {string} sectionName
 * @param {string} itemId
 * @param {string} newText
 */
function handleTodoEdit(sectionName, itemId, newText) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;
  const item = section.items.find(i => i.id === itemId);
  if (!item) return;

  const trimmed = newText.trim();
  if (trimmed && trimmed !== item.text) {
    item.text = trimmed;
    saveTodoDebounced();
  }
  renderTodoSections();
}

/**
 * Handle deleting a todo item
 * @param {string} sectionName
 * @param {string} itemId
 */
function handleTodoDelete(sectionName, itemId) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;

  const el = document.querySelector(`[data-todo-id="${itemId}"]`);
  if (el) {
    el.classList.add('removing');
    setTimeout(() => {
      section.items = section.items.filter(i => i.id !== itemId);
      saveTodoDebounced();
      renderTodoSections();
    }, 250);
  }
}

/**
 * Handle cycling priority for a todo item
 */
function handleTodoCyclePriority(sectionName, itemId) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;
  const item = section.items.find(i => i.id === itemId);
  if (!item) return;

  const priorityLevels = ['S', 'A', 'B', 'C', null];
  const index = priorityLevels.indexOf(item.priority);
  item.priority = priorityLevels[(index + 1) % priorityLevels.length];
  saveTodoDebounced();
  renderTodoSections();
}

/**
 * Handle cycling category for a todo item
 */
function handleTodoCycleCategory(sectionName, itemId) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;
  const item = section.items.find(i => i.id === itemId);
  if (!item) return;

  const index = CATEGORIES.indexOf(item.category);
  item.category = CATEGORIES[(index + 1) % CATEGORIES.length];
  saveTodoDebounced();
  renderTodoSections();
}

// ─── Cross-Tab Move ───

/**
 * Close any open move menu
 */
function closeMoveMenu() {
  const existing = document.querySelector('.move-menu');
  if (existing) existing.remove();
}

// Close move menu on any outside click
document.addEventListener('click', closeMoveMenu);

/**
 * Show a dropdown menu for moving a todo item
 * @param {HTMLElement} anchor - The button element to position relative to
 * @param {string} fromSection - Current section name
 * @param {string} itemId - Todo item ID
 */
function showMoveMenu(anchor, fromSection, itemId) {
  closeMoveMenu();

  const menu = document.createElement('div');
  menu.className = 'move-menu';

  // Option: move to daily tasks
  const dailyOption = document.createElement('div');
  dailyOption.className = 'move-menu-item';
  dailyOption.textContent = '📌 今日任务';
  dailyOption.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMoveMenu();
    handleMoveToDaily(fromSection, itemId);
  });
  menu.appendChild(dailyOption);

  // Options: move to other todo sections
  for (const section of todoData.sections) {
    if (section.name === fromSection) continue;
    const option = document.createElement('div');
    option.className = 'move-menu-item';
    option.textContent = `→ ${section.name}`;
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMoveMenu();
      handleMoveTodoSection(fromSection, section.name, itemId);
    });
    menu.appendChild(option);
  }

  // Position the menu near the anchor using fixed positioning
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  document.body.appendChild(menu);
}

/**
 * Move a daily task to the To-do List (default: 短期任务 section)
 * @param {string} taskId - Daily task ID
 */
function handleMoveToTodo(taskId) {
  const task = taskManager.tasks.find(t => t.id === taskId);
  if (!task) return;

  // Find target section (短期任务, or first section as fallback)
  let targetSection = todoData.sections.find(s => s.name === '短期任务');
  if (!targetSection && todoData.sections.length > 0) {
    targetSection = todoData.sections[0];
  }
  if (!targetSection) return;

  // Create todo item from daily task
  const newItem = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    text: task.content,
    reference: null,
    priority: task.priority,
    category: task.category,
    completed: false,
    order: targetSection.items.length
  };

  // Add to todo, remove from daily
  targetSection.items.push(newItem);
  taskManager.deleteTask(taskId);

  // Save and render both
  saveTasksDebounced();
  saveTodoDebounced();
  renderTasks();
  renderTodoSections();
}

/**
 * Move a todo item to today's Daily Tasks
 * @param {string} sectionName - Source section name
 * @param {string} itemId - Todo item ID
 */
function handleMoveToDaily(sectionName, itemId) {
  const section = todoData.sections.find(s => s.name === sectionName);
  if (!section) return;
  const item = section.items.find(i => i.id === itemId);
  if (!item) return;

  // Create daily task from todo item
  const newTask = taskManager.createTask(item.text, item.priority);
  newTask.category = item.category;

  // Remove from todo
  section.items = section.items.filter(i => i.id !== itemId);

  // Save and render both
  saveTasksDebounced();
  saveTodoDebounced();
  renderTasks();
  renderTodoSections();
}

/**
 * Move a todo item from one section to another within the To-do List
 * @param {string} fromSection - Source section name
 * @param {string} toSection - Target section name
 * @param {string} itemId - Todo item ID
 */
function handleMoveTodoSection(fromSection, toSection, itemId) {
  const srcSection = todoData.sections.find(s => s.name === fromSection);
  const dstSection = todoData.sections.find(s => s.name === toSection);
  if (!srcSection || !dstSection) return;

  const item = srcSection.items.find(i => i.id === itemId);
  if (!item) return;

  // Move: remove from source, append to destination
  srcSection.items = srcSection.items.filter(i => i.id !== itemId);
  item.order = dstSection.items.length;
  dstSection.items.push(item);

  saveTodoDebounced();
  renderTodoSections();
}

/**
 * Save todo data with debouncing (300ms)
 * Also syncs to Obsidian if sync is enabled
 */
function saveTodoDebounced() {
  if (todoSaveTimeout) {
    clearTimeout(todoSaveTimeout);
  }
  if (todoSync) {
    todoSync.pendingLocalChanges = true;
  }

  todoSaveTimeout = setTimeout(async () => {
    try {
      await storage.saveTodoData(todoData);
      if (todoSync?.connected) {
        await todoSync.syncToRemote(todoData);
      }
    } catch (error) {
      console.error('Failed to save todo:', error);
    }
  }, 300);
}

// ─── Task 11: Completion Feedback ───

const ENCOURAGE = ['漂亮!', '搞定一个 👍', '稳!', '又近一步', '就是这个节奏'];
const ENCOURAGE_OVER = ['超神! 🔥', '额外拿下一件!', '今天血赚', '余力惊人 ✨'];

let _audioCtx = null;

/**
 * Play a soft chime sound using Web Audio API.
 * The completion click is the user gesture that unlocks AudioContext.
 * @param {'base'|'over'} kind
 */
function playChime(kind) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const base = kind === 'over' ? 660 : 523;
    const play = () => {
      [0, 0.12].forEach((t, i) => {
        const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = base * (i ? 1.5 : 1);
        g.gain.setValueAtTime(0.0001, _audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.18, _audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + t + 0.25);
        o.connect(g).connect(_audioCtx.destination);
        o.start(_audioCtx.currentTime + t); o.stop(_audioCtx.currentTime + t + 0.26);
      });
    };
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch (e) { /* audio failure never blocks completion */ }
}

/**
 * Fire confetti particles from upper-center of the fx-canvas overlay.
 * @param {{ gold?: boolean, count?: number }} [opts]
 */
function fireConfetti(opts) {
  const canvas = document.getElementById('fx-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  canvas.style.display = 'block';
  const colors = opts && opts.gold
    ? ['#f9ab00', '#fbc02d', '#ffd54f']
    : ['#34a853', '#4285f4', '#ea4335', '#fbbc04'];
  const n = (opts && opts.count) || 80;
  const parts = Array.from({ length: n }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.3,
    vx: (Math.random() - 0.5) * 8, vy: Math.random() * -8 - 3,
    s: Math.random() * 6 + 4, c: colors[(Math.random() * colors.length) | 0], life: 1
  }));
  let raf;
  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += 0.3; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      if (p.life > 0 && p.y < canvas.height) {
        alive = true;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
    if (alive) raf = requestAnimationFrame(frame);
    else { cancelAnimationFrame(raf); canvas.style.display = 'none'; }
  })();
}

/**
 * Show an encouragement message that fades in then out above the must-do list.
 * @param {string} text
 */
function flashEncouragement(text) {
  const el = document.createElement('div');
  el.className = 'encourage';
  el.textContent = text;
  const list = document.getElementById('must-do-list');
  if (!list) return;
  list.parentNode.insertBefore(el, list.nextSibling);
  setTimeout(() => el.remove(), 1700);
}

/**
 * Trigger the full completion feedback suite: encouragement, confetti, chime.
 * @param {boolean} isOverAchieve - true when completing a bonus (over-achieve) item
 */
function triggerCompletionFx(isOverAchieve) {
  const pool = isOverAchieve ? ENCOURAGE_OVER : ENCOURAGE;
  flashEncouragement(pool[(Math.random() * pool.length) | 0]);
  fireConfetti({ gold: isOverAchieve, count: isOverAchieve ? 120 : 70 });
  playChime(isOverAchieve ? 'over' : 'base');
}

/**
 * Show the all-done celebration block when every must-do item is complete.
 * Displays a trophy, titles, and a button to switch to the pool (todo) tab.
 * Also fires a large confetti burst and reveals the board panel (Task 14).
 */
function showAllDoneCelebration() {
  const el = document.getElementById('celebrate');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = '';

  const trophy = document.createElement('div');
  trophy.className = 'trophy';
  trophy.textContent = '\u{1F3C6}';   // 🏆 — 8-hex escape avoids surrogate issues

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = '今日必做全部达成';

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = '今天你赢了';

  const btn = document.createElement('button');
  btn.className = 'add-task-btn pool-entry';
  btn.textContent = '还有余力？从任务池捞一个 →';
  btn.addEventListener('click', () => {
    const poolTab = document.querySelector('.tab[data-tab="todo"]');
    if (poolTab) poolTab.click();
  });

  el.append(trophy, title, sub, btn);

  fireConfetti({ count: 140 });

  // Board panel revealed by Task 14; guard so this task works before Task 14 lands
  if (typeof refreshBoard === 'function') refreshBoard();
  const boardEl = document.getElementById('board');
  if (boardEl) boardEl.style.display = 'block';
}

// ─── Task 13: Over-Achieve Gold Celebration ───

/**
 * Complete a pool (todo) item and trigger over-achieve gold celebration
 * if all must-do items are already complete and this item is a bonus (non-today).
 * Wired to pool task-completion in Task 15.
 * @param {string} id - Todo item id
 */
async function completePoolItem(id) {
  const item = findTodoItem(id);
  if (!item || item.completed) return;
  item.completed = true;
  await saveTodoDebounced();
  const over = !item.today && allMustDoComplete(todoData);
  if (over) {
    await storage.addTodayExtra(getLocalToday(), item.text);
    triggerCompletionFx(true);
    showOverAchieveCelebration(item.text);
  } else {
    triggerCompletionFx(false);
  }
  renderTodoSections();   // pool re-render (existing / Task 15)
  renderToday();
  if (typeof refreshBoard === 'function') refreshBoard();
}

/**
 * Mark a pool item as today's must-do (today: true).
 * Enforces the max-3 cap via canAddMustDo.
 * @param {string} id - Todo item id
 */
async function setMustDo(id) {
  if (!canAddMustDo(todoData)) {
    showError('今日必做最多 3 个，先完成或退回一个');
    return;
  }
  const item = findTodoItem(id);
  if (!item) return;
  item.today = true;
  await saveTodoDebounced();
  renderTodoSections();
  renderToday();
}

/**
 * Create a brand-new must-do item and push it directly into the pool
 * (短期 section by preference) with today: true.
 * @param {string} text - Task text
 */
async function addTempMustDo(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  if (!canAddMustDo(todoData)) {
    showError('今日必做最多 3 个，先完成或退回一个');
    return;
  }
  const section = todoData.sections.find(s => s.name.includes('短期')) || todoData.sections[0];
  if (!section) return;
  section.items.push({
    id: 'm' + Date.now().toString(36),
    text: trimmed,
    reference: null,
    priority: null,
    category: null,
    completed: false,
    order: section.items.length,
    today: true
  });
  await saveTodoDebounced();
  renderTodoSections();
  renderToday();
}

/**
 * Show a transient gold over-achieve celebration box inside #celebrate.
 * Auto-removes itself after 4 seconds.
 * @param {string} text - The task text that was completed
 */
function showOverAchieveCelebration(text) {
  const el = document.getElementById('celebrate');
  if (!el) return;
  el.style.display = 'block';
  const box = document.createElement('div');
  box.className = 'overachieve';
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.textContent = '\u{1F947}';   // 🥇 — 8-hex escape avoids surrogate issues
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = '超额 +1 · 超神';   // 超额 +1 · 超神
  box.append(icon, title);
  el.appendChild(box);
  setTimeout(() => box.remove(), 4000);
}

// ─── Task 14: Long-Term Board ───

/**
 * Return a badge label based on monthly over-achieve count, or null if below threshold.
 * @param {number} monthly - Number of over-achieved days this month
 * @returns {string|null}
 */
function badgeFor(monthly) {
  if (monthly >= 20) return '高效达人';   // 高效达人
  if (monthly >= 10) return '稳步前进';   // 稳步前进
  return null;
}

/**
 * Compute board data by merging a live today record into completion history.
 * @returns {Promise<{streak:number, weekly:number, monthly:number}>}
 */
async function computeBoardData() {
  const history = await storage.getCompletionHistory();
  const today = getLocalToday();
  const live = buildDayRecord(todoData, await storage.getTodayExtra(today));
  const merged = { ...history, [today]: live };
  const streak = computeStreak(merged, today);
  const weekly = tallyOverAchieved(merged, addDays(today, -6), today);
  const monthStart = today.slice(0, 8) + '01';
  const monthly = tallyOverAchieved(merged, monthStart, today);
  return { streak, weekly, monthly };
}

/**
 * Refresh the streak mini-display (🔥 N 天) in the today header.
 * Updates #streak-num if the element exists.
 */
async function refreshStreakMini() {
  const el = document.getElementById('streak-num');
  if (!el) return;
  try {
    const { streak } = await computeBoardData();
    el.textContent = streak;
  } catch (e) {
    console.error('refreshStreakMini failed:', e);
  }
}

/**
 * Render the long-term motivation board into #board.
 * Shows streak card, weekly/monthly metrics, and optional badge.
 */
async function refreshBoard() {
  const board = document.getElementById('board');
  if (!board) return;
  try {
    const { streak, weekly, monthly } = await computeBoardData();

    // Also update streak mini display
    const streakNumEl = document.getElementById('streak-num');
    if (streakNumEl) streakNumEl.textContent = streak;

    board.innerHTML = '';

    // Streak card
    const sc = document.createElement('div');
    sc.className = 'streak-card';

    const fire = document.createElement('div');
    fire.style.fontSize = '26px';
    fire.textContent = '\u{1F525}';   // 🔥 — 8-hex escape avoids surrogate issues

    const big = document.createElement('div');
    big.className = 'big';
    big.textContent = '连续 ' + streak + ' 天达成';   // 连续 N 天达成

    sc.append(fire, big);

    // Metrics row
    const metrics = document.createElement('div');
    metrics.className = 'metrics';

    for (const [num, lbl] of [[weekly, '本周超额'], [monthly, '本月超额']]) {
      // 本周超额, 本月超额
      const m = document.createElement('div');
      m.className = 'metric';
      const nEl = document.createElement('div');
      nEl.className = 'num';
      nEl.textContent = num;
      const lEl = document.createElement('div');
      lEl.className = 'lbl';
      lEl.textContent = lbl;
      m.append(nEl, lEl);
      metrics.appendChild(m);
    }

    board.append(sc, metrics);

    // Optional badge
    const badge = badgeFor(monthly);
    if (badge) {
      const b = document.createElement('div');
      b.className = 'badge';
      b.textContent = '\u{1F3C5} 本月徽章 · ' + badge;   // 🏅 本月徽章 · …
      board.appendChild(b);
    }
  } catch (e) {
    console.error('refreshBoard failed:', e);
  }
}
