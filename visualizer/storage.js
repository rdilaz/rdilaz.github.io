const DB_NAME = 'ai-visualizer-v0';
const DB_VERSION = 2;
const GENERATION_STORE = 'generations';
const DIAGNOSTIC_STORE = 'diagnostics';
const MAX_DIAGNOSTICS = 60;

function createGenerationStore(db) {
  if (db.objectStoreNames.contains(GENERATION_STORE)) return;
  const store = db.createObjectStore(GENERATION_STORE, { keyPath: 'id' });
  store.createIndex('createdAt', 'createdAt');
  store.createIndex('modelId', 'modelId');
  store.createIndex('favorite', 'favorite');
}

function createDiagnosticStore(db) {
  if (db.objectStoreNames.contains(DIAGNOSTIC_STORE)) return;
  const store = db.createObjectStore(DIAGNOSTIC_STORE, { keyPath: 'id' });
  store.createIndex('createdAt', 'createdAt');
  store.createIndex('modelId', 'modelId');
  store.createIndex('status', 'status');
  store.createIndex('failureCode', 'failureCode');
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      createGenerationStore(db);
      createDiagnosticStore(db);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  });
}

class BrowserStore {
  constructor(storeName) {
    this.storeName = storeName;
    this.db = null;
    this.memory = new Map();
    this.persistent = true;
  }

  async init() {
    try {
      this.db = await openDatabase();
    } catch {
      this.persistent = false;
    }
    return this;
  }

  async put(value) {
    const copy = structuredClone(value);
    if (!this.db) {
      this.memory.set(copy.id, copy);
      return value;
    }
    const transaction = this.db.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).put(copy);
    await transactionDone(transaction);
    return value;
  }

  async get(id) {
    if (!this.db) return this.memory.get(id) || null;
    return requestResult(this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(id));
  }

  async list() {
    if (!this.db) return [...this.memory.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const values = await requestResult(this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll());
    return values.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async remove(id) {
    if (!this.db) {
      this.memory.delete(id);
      return;
    }
    const transaction = this.db.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).delete(id);
    await transactionDone(transaction);
  }

  async clear() {
    if (!this.db) {
      this.memory.clear();
      return;
    }
    const transaction = this.db.transaction(this.storeName, 'readwrite');
    transaction.objectStore(this.storeName).clear();
    await transactionDone(transaction);
  }

  async update(id, patch) {
    const existing = await this.get(id);
    if (!existing) return null;
    const next = { ...existing, ...structuredClone(patch), updatedAt: Date.now() };
    await this.put(next);
    return next;
  }
}

export class GenerationStore extends BrowserStore {
  constructor() {
    super(GENERATION_STORE);
  }

  async toggleFavorite(id) {
    const existing = await this.get(id);
    if (!existing) return null;
    return this.update(id, { favorite: !existing.favorite });
  }

  async recordBattle(winnerId, loserId) {
    const [winner, loser] = await Promise.all([this.get(winnerId), this.get(loserId)]);
    if (!winner || !loser) return;
    await Promise.all([
      this.update(winnerId, { battleWins: (winner.battleWins || 0) + 1 }),
      this.update(loserId, { battleLosses: (loser.battleLosses || 0) + 1 }),
    ]);
  }
}

export class DiagnosticStore extends BrowserStore {
  constructor() {
    super(DIAGNOSTIC_STORE);
  }

  async put(value) {
    const existing = await this.get(value.id);
    await super.put(value);
    if (!existing) await this.prune();
    return value;
  }

  async list(limit = MAX_DIAGNOSTICS) {
    const values = await super.list();
    return values.slice(0, Math.max(1, limit));
  }

  async latest() {
    return (await this.list(1))[0] || null;
  }

  async prune(limit = MAX_DIAGNOSTICS) {
    const values = await super.list();
    const stale = values.slice(limit);
    if (!stale.length) return;
    await Promise.all(stale.map(value => this.remove(value.id)));
  }
}
