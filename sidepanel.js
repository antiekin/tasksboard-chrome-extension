// Sidepanel UI Controller
// Handles all UI interactions and DOM manipulation

// Initialize task manager
const taskManager = new TaskManager();

// DOM elements
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
let todayCompleted = [];   // today's completions read from the Feishu bot log
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

  // 进度环：百分比跟随完成数
  const ringEl = document.getElementById('ring');
  if (ringEl) ringEl.style.setProperty('--p', mustDo.length ? Math.round(done / mustDo.length * 100) : 0);

  // Streak display — refreshStreakMini defined by Task 11; stub if absent
  if (typeof refreshStreakMini === 'function') refreshStreakMini();

  renderTodayExtra(mustDo);

  // Hide celebration and board when not all must-do items are complete
  if (!allMustDoComplete(todoData)) {
    document.getElementById('celebrate').style.display = 'none';
    document.getElementById('board').style.display = 'none';
  }
}

function renderTodayExtra(mustDo) {
  const mustDoTexts = new Set(mustDo.map(i => i.text));
  const extra = todayCompleted.filter(c => !mustDoTexts.has(c.text));
  const extraEl = document.getElementById('today-extra');
  if (extraEl) {
    extraEl.innerHTML = '';
    if (extra.length > 0) {
      extraEl.style.display = 'block';
      const head = document.createElement('div');
      head.className = 'extra-head';
      head.textContent = '✨ 今天额外完成';
      extraEl.appendChild(head);
      for (const c of extra) {
        const row = document.createElement('div');
        row.className = 'extra-done-row';
        row.textContent = '✅ ' + c.text;
        extraEl.appendChild(row);
      }
    } else {
      extraEl.style.display = 'none';
    }
  }
  const doneMain = mustDo.filter(i => i.completed).length;
  const totalDone = doneMain + extra.length;
  const cheerEl = document.getElementById('today-cheer');
  if (cheerEl) {
    if (totalDone > 0) {
      cheerEl.style.display = 'block';
      const allDone = mustDo.length > 0 && doneMain === mustDo.length;
      cheerEl.textContent = allDone
        ? '🎉 今日必做全部完成，还额外做了 ' + extra.length + ' 件，今天太棒了！'
        : '💪 今天已完成 ' + totalDone + ' 件，保持这个势头！';
    } else {
      cheerEl.style.display = 'none';
    }
  }
}

async function loadTodayCompleted() {
  try {
    if (obsidianSync && obsidianSync.connected && typeof obsidianSync.readTodayCompletionLog === 'function') {
      const md = await obsidianSync.readTodayCompletionLog();
      todayCompleted = parseCompletionLog(md || '');
      renderToday();
    }
  } catch (e) { /* offline is fine */ }
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
async function logCompletion(item) {
  if (obsidianSync && obsidianSync.connected && typeof obsidianSync.appendTodayCompletion === 'function') {
    try {
      await obsidianSync.appendTodayCompletion(item.text, item.category);
      await loadTodayCompleted();
    } catch (e) { /* offline is fine */ }
  }
}

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
  logCompletion(item);
}

/**
 * Archive the day: save completion record, write Obsidian log, reset today flags
 * @param {string} dateStr - YYYY-MM-DD date to archive
 */
async function handleDailyArchive(dateStr) {
  try {
    // Idempotency guard: don't overwrite a good record already written for this day
    const hist = await storage.getCompletionHistory();
    if (hist[dateStr] && hist[dateStr].mustDoTotal > 0) return;

    const extra = await storage.getTodayExtra(dateStr);
    const mustDo = getMustDoItems(todoData).map(i => ({ text: i.text, completed: i.completed }));
    const record = buildDayRecord(todoData, extra);
    await storage.saveCompletionDay(dateStr, record);
    if (obsidianSync && obsidianSync.connected) {
      await obsidianSync.writeDailyLog(dateStr, mustDo, record.overAchieved);
    }
    // Clear #今日 flags across all sections — persist synchronously so flags
    // survive a midnight panel teardown (don't rely on 300ms debounce)
    for (const s of todoData.sections) {
      for (const it of s.items) it.today = false;
    }
    await storage.saveTodoData(todoData);
    if (todoSync && todoSync.connected) {
      try { await todoSync.syncToRemote(todoData); } catch (e) { /* offline is fine; local is saved */ }
    }
    await storage.clearTodayExtra();
    renderToday();
  } catch (error) {
    console.error('Failed to handle daily archive:', error);
  }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
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
  setupSettingsListeners();
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
  } catch (error) {
    console.error('Failed to load data:', error);
    showError('无法加载任务数据');
  }
}

/**
 * Setup settings and today-page event listeners
 */
function setupSettingsListeners() {
  // Settings panel toggle
  if (settingsBtn) settingsBtn.addEventListener('click', toggleSettingsPanel);

  // Save settings
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', handleSaveSettings);

  // Test connection
  if (testConnectionBtn) testConnectionBtn.addEventListener('click', handleTestConnection);

  // Temporary must-do add button
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
        loadTodayCompleted();
        setInterval(loadTodayCompleted, 30000);

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
  renderToday();
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
  if (!item.completed) {
    mustdoBtn = document.createElement('button');
    mustdoBtn.className = 'set-mustdo-btn' + (item.today ? ' is-today' : '');
    mustdoBtn.textContent = item.today ? '\u{21A9}' : '\u{1F3AF}';
    mustdoBtn.title = item.today ? '取消今日必做' : '设为今日必做';
    mustdoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.today) unsetMustDo(item.id);
      else setMustDo(item.id);
    });
  }

  // —— 次要操作收进 ⋯ 更多菜单 ——
  const taskActions = document.createElement('div');
  taskActions.className = 'task-actions';

  const moreBtn = document.createElement('button');
  moreBtn.className = 'more-btn';
  moreBtn.textContent = '⋯';
  moreBtn.title = '更多操作';
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTaskMenu(taskActions);
  });

  const moreMenu = document.createElement('div');
  moreMenu.className = 'task-more-menu';
  moreMenu.addEventListener('click', (e) => e.stopPropagation());

  // 移动到…
  const moveBtn = document.createElement('button');
  moveBtn.className = 'move-btn';
  moveBtn.textContent = '↗ 移动到…';
  moveBtn.title = '移动到…';
  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showMoveMenu(moveBtn, sectionName, item.id);
  });
  moreMenu.appendChild(moveBtn);

  // 查看引用（若有）
  if (item.reference) {
    const refIcon = document.createElement('span');
    refIcon.className = 'todo-reference';
    refIcon.textContent = '🔗 查看引用';
    const tooltip = document.createElement('span');
    tooltip.className = 'todo-ref-tooltip';
    tooltip.textContent = TodoSync.getRefDisplay(item.reference);
    refIcon.appendChild(tooltip);
    moreMenu.appendChild(refIcon);
  }

  // 删除
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '🗑 删除';
  deleteBtn.title = '删除';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleTodoDelete(sectionName, item.id);
  });
  moreMenu.appendChild(deleteBtn);

  taskActions.appendChild(moreBtn);
  taskActions.appendChild(moreMenu);

  // —— Assemble ——
  itemEl.appendChild(dragHandle);
  itemEl.appendChild(checkbox);
  itemEl.appendChild(priorityBadge);
  itemEl.appendChild(content);
  itemEl.appendChild(categoryTag);
  if (mustdoBtn) itemEl.appendChild(mustdoBtn);
  itemEl.appendChild(taskActions);

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

  const wasCompleted = item.completed;
  item.completed = !item.completed;
  saveTodoDebounced();
  renderTodoSections();
  if (!wasCompleted && item.completed) logCompletion(item);
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

/** 关闭所有打开的「⋯ 更多」菜单 */
function closeAllTaskMenus() {
  document.querySelectorAll('.task-actions.open').forEach((box) => {
    box.classList.remove('open', 'up');
    const ti = box.closest('.task-item');
    if (ti) ti.style.zIndex = '';
  });
}

/** 切换某行的「⋯ 更多」菜单；靠近底部时向上翻 */
function toggleTaskMenu(box) {
  const wasOpen = box.classList.contains('open');
  closeAllTaskMenus();
  if (wasOpen) return;
  box.classList.add('open');
  const ti = box.closest('.task-item');
  if (ti) ti.style.zIndex = '60';
  const menu = box.querySelector('.task-more-menu');
  const cont = document.querySelector('.container');
  if (menu && cont) {
    const mb = menu.getBoundingClientRect();
    const cb = cont.getBoundingClientRect();
    if (mb.bottom > cb.bottom - 6) box.classList.add('up');
  }
}

// Close move menu on any outside click
document.addEventListener('click', closeMoveMenu);
document.addEventListener('click', closeAllTaskMenus);

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

  // Options: move to other todo sections.
  // (Setting an item as a today must-do is done via the 🎯 button, which tags
  //  it #今日 and keeps it in the pool — NOT a move. The old "move to daily"
  //  option was removed: it relocated items into the retired daily-list store
  //  that the today page no longer renders, making them vanish from both views.)
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
/** 全部达成庆祝用的「开花小花园」SVG（蜜桃花园设计，静态） */
const CELEBRATE_SVG = `<svg viewBox="0 0 132 100" aria-hidden="true">
          <ellipse cx="66" cy="90" rx="50" ry="7" fill="#EBD7BE" opacity=".5"/>
          <!-- 左侧绽放的花 -->
          <g class="bloomf">
            <line x1="26" y1="90" x2="26" y2="64" stroke="#5F8369" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M26 78 C18 78 14 73 14 68 C22 68 26 72 26 78Z" fill="#8FB39A"/>
            <circle cx="26" cy="56" r="5.4" fill="#F4A982"/><circle cx="34" cy="61" r="5.4" fill="#F4A982"/><circle cx="31" cy="70" r="5.4" fill="#F4A982"/><circle cx="21" cy="70" r="5.4" fill="#F4A982"/><circle cx="18" cy="61" r="5.4" fill="#F4A982"/>
            <circle cx="26" cy="63" r="4" fill="#FBD46B"/>
          </g>
          <!-- 右侧绽放的花 -->
          <g class="bloomf f2">
            <line x1="106" y1="90" x2="106" y2="64" stroke="#5F8369" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M106 78 C114 78 118 73 118 68 C110 68 106 72 106 78Z" fill="#8FB39A"/>
            <circle cx="106" cy="56" r="5.4" fill="#E8896B"/><circle cx="114" cy="61" r="5.4" fill="#E8896B"/><circle cx="111" cy="70" r="5.4" fill="#E8896B"/><circle cx="101" cy="70" r="5.4" fill="#E8896B"/><circle cx="98" cy="61" r="5.4" fill="#E8896B"/>
            <circle cx="106" cy="63" r="4" fill="#FBD46B"/>
          </g>
          <!-- 中间小芽（开心） -->
          <g>
            <path d="M50 70 h32 l-3 16 a4.5 4.5 0 0 1-4.5 3.6 H57.5 a4.5 4.5 0 0 1-4.5-3.6 Z" fill="#E8896B"/>
            <rect x="48" y="65.5" width="36" height="7.5" rx="3.75" fill="#D2694B"/>
            <path d="M66 70 V49" stroke="#5F8369" stroke-width="3" stroke-linecap="round"/>
            <path d="M66 58 C57 58 52 51.5 52 46 C60 46 66 50.5 66 58Z" fill="#8FB39A"/>
            <path d="M66 56 C75 56 80 49.5 80 44 C72 44 66 48.5 66 56Z" fill="#A6C6AE"/>
            <circle cx="66" cy="42" r="9" fill="#F4C9A8"/>
            <path d="M60.6 42.4 q1.7 -2.2 3.4 0" stroke="#4A3A31" stroke-width="1.3" fill="none" stroke-linecap="round"/>
            <path d="M68 42.4 q1.7 -2.2 3.4 0" stroke="#4A3A31" stroke-width="1.3" fill="none" stroke-linecap="round"/>
            <path d="M62.6 45.6 q3.4 3 6.8 0" stroke="#4A3A31" stroke-width="1.2" fill="none" stroke-linecap="round"/>
            <circle cx="59.4" cy="45" r="1.7" fill="#E8896B" opacity=".55"/>
            <circle cx="72.6" cy="45" r="1.7" fill="#E8896B" opacity=".55"/>
          </g>
          <!-- 闪光 -->
          <path d="M40 28 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4Z" fill="#FBD46B"/>
          <path d="M95 24 l1.1 2.7 2.7 1.1 -2.7 1.1 -1.1 2.7 -1.1 -2.7 -2.7 -1.1 2.7 -1.1Z" fill="#F4A982"/>
        </svg>`;

/** 小芽伙伴：完成时蹦跳欢呼一下 */
function cheerMascot() {
  const m = document.getElementById('mascot');
  if (!m) return;
  m.classList.add('cheer');
  setTimeout(() => m.classList.remove('cheer'), 650);
}

function triggerCompletionFx(isOverAchieve) {
  const pool = isOverAchieve ? ENCOURAGE_OVER : ENCOURAGE;
  flashEncouragement(pool[(Math.random() * pool.length) | 0]);
  fireConfetti({ gold: isOverAchieve, count: isOverAchieve ? 120 : 70 });
  playChime(isOverAchieve ? 'over' : 'base');
  cheerMascot();
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
  trophy.innerHTML = CELEBRATE_SVG;   // 蜜桃花园 · 开花庆祝（静态 SVG，无注入风险）

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
  logCompletion(item);   // 写完成日志 + 刷新今日页「额外完成」（之前漏了这条真实路径）
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

async function unsetMustDo(id) {
  const item = findTodoItem(id);
  if (!item) return;
  item.today = false;
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
