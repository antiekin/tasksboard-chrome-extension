// Sidepanel UI Controller
// Handles all UI interactions and DOM manipulation

// Initialize task manager
const taskManager = new TaskManager();

// DOM elements
let taskListContainer, completedList, completedSection, completedHeader;
let addTaskBtn, emptyState, completedCount;

// State
let preferences = { completedSectionExpanded: false };
let saveTimeout = null;

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

  // Load data
  await loadData();

  // Setup event listeners
  setupEventListeners();

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
 */
function saveTasksDebounced() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(async () => {
    try {
      await storage.saveTasks(taskManager.getAllTasks());
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
