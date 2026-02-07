// Task Manager - Business logic layer
// Pure logic, no DOM manipulation

class TaskManager {
  constructor() {
    this.tasks = [];
  }

  /**
   * Generate unique ID for tasks
   * @returns {string} UUID-like string
   */
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Get today's date in ISO format (YYYY-MM-DD)
   * @returns {string} Today's date
   */
  getTodayDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Create a new task
   * @param {string} content - Task content
   * @param {string|null} priority - Priority level (S, A, B, C, or null)
   * @returns {Object} New task object
   */
  createTask(content, priority = null) {
    const maxOrder = this.tasks.length > 0
      ? Math.max(...this.tasks.map(t => t.order))
      : -1;

    const task = {
      id: this.generateId(),
      content: content.trim(),
      priority: priority,
      completed: false,
      order: maxOrder + 1,
      createdAt: this.getTodayDate(),
      completedAt: null
    };

    this.tasks.push(task);
    return task;
  }

  /**
   * Update a task
   * @param {string} id - Task ID
   * @param {Object} updates - Properties to update
   * @returns {Object|null} Updated task or null if not found
   */
  updateTask(id, updates) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    Object.assign(task, updates);
    return task;
  }

  /**
   * Delete a task
   * @param {string} id - Task ID
   * @returns {boolean} True if deleted, false if not found
   */
  deleteTask(id) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index === -1) return false;

    this.tasks.splice(index, 1);
    return true;
  }

  /**
   * Toggle task completion status
   * @param {string} id - Task ID
   * @returns {Object|null} Updated task or null if not found
   */
  toggleComplete(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    return task;
  }

  /**
   * Cycle priority to next level
   * @param {string} id - Task ID
   * @returns {Object|null} Updated task or null if not found
   */
  cyclePriority(id) {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    const priorityLevels = ['S', 'A', 'B', 'C', null];
    const currentIndex = priorityLevels.indexOf(task.priority);
    const nextIndex = (currentIndex + 1) % priorityLevels.length;
    task.priority = priorityLevels[nextIndex];

    return task;
  }

  /**
   * Reorder tasks based on new positions
   * @param {string} taskId - Task being moved
   * @param {number} newOrder - New order position
   */
  reorderTasks(taskId, newOrder) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return;

    task.order = newOrder;
  }

  /**
   * Normalize all task orders to sequential integers (0, 1, 2, ...)
   */
  normalizeOrders() {
    const sortedTasks = [...this.tasks].sort((a, b) => a.order - b.order);
    sortedTasks.forEach((task, index) => {
      task.order = index;
    });
  }

  /**
   * Get today's tasks
   * @returns {Array} Tasks created today
   */
  getTodaysTasks() {
    const today = this.getTodayDate();
    return this.tasks.filter(t => t.createdAt === today);
  }

  /**
   * Get active (incomplete) tasks
   * @returns {Array} Active tasks sorted by order
   */
  getActiveTasks() {
    return this.getTodaysTasks()
      .filter(t => !t.completed)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Get completed tasks
   * @returns {Array} Completed tasks sorted by completion time
   */
  getCompletedTasks() {
    return this.getTodaysTasks()
      .filter(t => t.completed)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  }

  /**
   * Clean up old completed tasks (older than 7 days)
   */
  cleanupOldTasks() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoffDate = sevenDaysAgo.toISOString().split('T')[0];

    this.tasks = this.tasks.filter(task => {
      if (!task.completed) return true;
      return task.createdAt >= cutoffDate;
    });
  }

  /**
   * Load tasks from array
   * @param {Array} tasks - Tasks array
   */
  loadTasks(tasks) {
    this.tasks = tasks || [];
    this.cleanupOldTasks();
  }

  /**
   * Get all tasks
   * @returns {Array} All tasks
   */
  getAllTasks() {
    return this.tasks;
  }
}
