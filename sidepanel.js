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
  todoFilePathInput = document.getElementById('todo-file-path-input');
  testConnectionBtn = document.getElementById('test-connection-btn');
  saveSettingsBtn = document.getElementById('save-settings-btn');
  connectionStatus = document.getElementById('connection-status');

  // Load data
  await loadData();

  // Check for daily rollover (before sync, so rolled-over tasks get pushed)
  await checkRollover();

  // Setup event listeners and tab switching
  setupEventListeners();
  setupTabSwitching();

  // Initialize sync (daily + todo)
  await initSync();

  // Listen for rollover notifications from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'rollover-complete') {
      handleRolloverComplete();
    }
  });

  // Initial render
  renderTasks();
  renderTodoSections();
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

      // Test connection first (determines HTTPS vs HTTP URL)
      const connected = await obsidianSync.testConnection();
      if (connected) {
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
    apiKey: apiKeyInput.value.trim(),
    vaultPath: vaultPathInput.value.trim() || '0. 目标及计划/Daily',
    todoFilePath: todoFilePathInput.value.trim() || '9. To-do List/Todo_List.md',
    pollInterval: 3000
  };

  try {
    await storage.saveSyncConfig(syncConfig);

    // Stop existing sync if running
    if (obsidianSync) {
      obsidianSync.stopPolling();
      obsidianSync = null;
    }
    if (todoSync) {
      todoSync.stopPolling();
      todoSync = null;
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

        // Restart todo sync
        await initTodoSync(syncConfig, obsidianSync.apiUrl);
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

// ─── Daily Rollover ───

/**
 * Request background to check and execute daily rollover
 */
async function checkRollover() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'check-rollover' });
    if (response?.performed) {
      // Reload tasks from storage (background already wrote them)
      const tasks = await storage.getAllTasks();
      taskManager.loadTasks(tasks);
    }
  } catch (error) {
    console.error('Failed to check rollover:', error);
  }
}

/**
 * Handle rollover-complete message from background (midnight trigger)
 */
async function handleRolloverComplete() {
  try {
    const tasks = await storage.getAllTasks();
    taskManager.loadTasks(tasks);
    renderTasks();

    // Push new tasks to Obsidian if connected
    if (obsidianSync?.connected) {
      await obsidianSync.syncToRemote(taskManager.getAllTasks());
    }
  } catch (error) {
    console.error('Failed to handle rollover complete:', error);
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

  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = 'task-checkbox';
  if (item.completed) checkbox.classList.add('checked');
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTodoToggle(sectionName, item.id);
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
