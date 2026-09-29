class TaskRegistry {
  constructor(logger) {
    this.logger = logger;
    this.tasks = new Map();
  }

  create(input = {}) {
    const id = String(input.id || crypto.randomUUID());
    const task = {
      id,
      type: String(input.type || 'generic'),
      state: 'queued',
      progress: null,
      message: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(id, task);
    return structuredClone(task);
  }

  update(id, patch = {}) {
    const current = this.tasks.get(id);
    if (!current) return null;
    const allowedStates = new Set(['queued','running','cancelling','cancelled','interrupted','failed','completed']);
    const next = {
      ...current,
      state: allowedStates.has(patch.state) ? patch.state : current.state,
      progress: normalizeProgress(patch.progress, current.progress),
      message: typeof patch.message === 'string' ? patch.message.slice(0, 240) : current.message,
      updatedAt: new Date().toISOString()
    };
    this.tasks.set(id, next);
    return structuredClone(next);
  }

  list() {
    return [...this.tasks.values()]
      .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(item=>structuredClone(item));
  }

  interruptRunning() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.state === 'running' || task.state === 'cancelling') {
        this.update(id, { state: 'interrupted', message: 'アプリ終了または再起動で中断されました。' });
      }
    }
  }
}

function normalizeProgress(value, fallback) {
  if (value == null) return fallback ?? null;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback ?? null;
  return Math.min(1, Math.max(0, number));
}

module.exports = { TaskRegistry };
