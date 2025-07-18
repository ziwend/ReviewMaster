/**
 * LRU缓存实现
 * @param {number} capacity 最大容量
 */
class LRUCache {
  constructor(capacity = 100) {
    this.capacity = capacity;
    this.cache = new Map(); // 存储键值对
    this.accessMap = new Map(); // 存储键->时间戳映射
    this.accessQueue = []; // 保留队列用于淘汰
  }

  /**
   * 获取缓存值
   * @param {string} key 缓存键
   * @returns {any} 缓存值或undefined
   */
  get(key) {
    if (this.cache.has(key)) {
      // 更新访问记录
      this._updateAccess(key);
      return this.cache.get(key);
    }
    return undefined;
  }

  /**
   * 设置缓存值
   * @param {string} key 缓存键
   * @param {any} value 缓存值
   */
  set(key, value) {
    // 如果存在则更新访问记录
    if (this.cache.has(key)) {
      this._updateAccess(key);
    } else {
      // 循环淘汰直到有足够空间
      while (this.cache.size >= this.capacity) {
        this._evict();
      }
      // 新项的访问记录会在_updateAccess中添加
      this._updateAccess(key);
    }
    this.cache.set(key, value);
  }

  /**
   * 删除缓存项
   * @param {string} key 缓存键
   */
  delete(key) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.accessMap.delete(key);
      // 不立即从队列中删除，而是在_evict或_cleanAccessQueue时处理
      // 这样可以避免O(n)的查找操作
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessMap.clear();
    this.accessQueue = [];
  }

  /**
   * 更新访问记录
   * @param {string} key 缓存键
   */
  _updateAccess(key) {
    // 使用时间戳更新访问记录
    const now = Date.now();
    this.accessMap.set(key, now);
    
    // 优化：直接添加到队列末尾，避免indexOf和splice操作
    // 在_evict时会处理重复项
    this.accessQueue.push({key, timestamp: now});
    
    // 当队列长度超过容量的2倍时，执行清理操作
    if (this.accessQueue.length > this.capacity * 2) {
      this._cleanAccessQueue();
    }
  }

  /**
   * 清理访问队列中的重复项和已删除项
   * 仅保留每个键的最新访问记录
   */
  _cleanAccessQueue() {
    const seen = new Set();
    const newQueue = [];
    
    // 从后向前遍历，只保留每个键的最新记录
    for (let i = this.accessQueue.length - 1; i >= 0; i--) {
      const {key} = this.accessQueue[i];
      if (!seen.has(key) && this.cache.has(key)) {
        seen.add(key);
        newQueue.unshift(this.accessQueue[i]);
      }
    }
    
    this.accessQueue = newQueue;
  }

  /**
   * 淘汰最近最少使用的项
   */
  _evict() {
    // 如果队列为空，直接返回
    if (this.accessQueue.length === 0) return;
    
    // 找到最早的有效缓存项
    let oldestIndex = 0;
    let oldestItem = null;
    
    // 查找最早的有效项
    while (oldestIndex < this.accessQueue.length) {
      const item = this.accessQueue[oldestIndex];
      if (this.cache.has(item.key)) {
        oldestItem = item;
        break;
      }
      oldestIndex++;
    }
    
    // 如果找到了有效项，删除它
    if (oldestItem) {
      this.cache.delete(oldestItem.key);
      this.accessMap.delete(oldestItem.key);
      this.accessQueue.splice(oldestIndex, 1);
    } else {
      // 如果没有找到有效项，清空队列
      this.accessQueue = [];
    }
  }
}

module.exports = LRUCache;
