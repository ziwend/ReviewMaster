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
      while (this.accessQueue.length >= this.capacity) {
        this._evict();
      }
      this.accessQueue.push(key);
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
      const index = this.accessQueue.indexOf(key);
      if (index > -1) {
        this.accessQueue.splice(index, 1);
      }
    }
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.accessQueue = [];
  }

  /**
   * 更新访问记录
   * @param {string} key 缓存键
   */
  _updateAccess(key) {
    // 使用时间戳更新访问记录
    this.accessMap.set(key, Date.now());
    // 更新队列中的位置
    const index = this.accessQueue.indexOf(key);
    if (index > -1) {
      this.accessQueue.splice(index, 1);
    }
    this.accessQueue.push(key);
  }

  /**
   * 淘汰最近最少使用的项
   */
  _evict() {
    const keyToRemove = this.accessQueue.shift();
    if (keyToRemove) {
      this.cache.delete(keyToRemove);
      this.accessMap.delete(keyToRemove);
    }
  }
}

module.exports = LRUCache;
