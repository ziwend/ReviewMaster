// utils/storage.js
// 统一存储与缓存API，仅允许通过 GroupManager 对象访问所有接口
// 禁止直接导出单独函数，所有对外API请通过 GroupManager 调用
// 例如：const GroupManager = require('../../utils/storage');
//       GroupManager.getAllGroups(), GroupManager.saveKnowledge(...)
// 
// 本文件已适配 LRU/TTL 缓存、分页、性能监控、API统一封装
// 如需扩展请务必保持接口一致性与高效性

// 本地存储与数据结构管理 (采用索引-数据分离模型)
const LRUCache = require('./lru');

const GroupManager = (() => {
  // 性能监控指标
  const perfMetrics = {
    groupCacheHits: 0,
    groupCacheMisses: 0,
    knowledgeCacheHits: 0,
    knowledgeCacheMisses: 0,
    storageReads: 0,
    storageWrites: 0,
    storageReadTime: 0,
    storageWriteTime: 0,
    groupDataLoadTime: 0,
    knowledgeLoadTime: 0,
    storageQuotaUsage: 0, // 新增，防止未定义

    // 获取缓存命中率
    getGroupCacheHitRate() {
      const total = this.groupCacheHits + this.groupCacheMisses;
      return total ? (this.groupCacheHits / total).toFixed(2) : 0;
    },

    getKnowledgeCacheHitRate() {
      const total = this.knowledgeCacheHits + this.knowledgeCacheMisses;
      return total ? (this.knowledgeCacheHits / total).toFixed(2) : 0;
    },

    // 获取平均读写时间
    getAvgReadTime() {
      return this.storageReads ? (this.storageReadTime / this.storageReads).toFixed(2) : 0;
    },

    getAvgWriteTime() {
      return this.storageWrites ? (this.storageWriteTime / this.storageWrites).toFixed(2) : 0;
    },

    // 获取内存使用情况
    getMemoryUsage() {
      try {
        if (wx.getPerformance) {
          const perf = wx.getPerformance();
          if (perf && perf.memory) {
            const memory = perf.memory;
            return {
              jsHeapSizeLimit: memory.jsHeapSizeLimit,
              totalJSHeapSize: memory.totalJSHeapSize,
              usedJSHeapSize: memory.usedJSHeapSize
            };
          }
        }
      } catch (e) {
        console.error('获取内存使用失败', e);
      }
      return null;
    },

    // 打印性能报告
    report() {
      const settings = getSettings();
      if (settings.enablePerfLogging) {
        console.log(`[性能报告] 分组缓存命中率: ${this.getGroupCacheHitRate()}`);
        console.log(`[性能报告] 知识点缓存命中率: ${this.getKnowledgeCacheHitRate()}`);
        console.log(`[性能报告] 存储读取: ${this.storageReads}次, 平均耗时: ${this.getAvgReadTime()}ms`);
        console.log(`[性能报告] 存储写入: ${this.storageWrites}次, 平均耗时: ${this.getAvgWriteTime()}ms`);
        console.log(`[性能报告] 分组数据加载时间: ${this.groupDataLoadTime}ms`);
        console.log(`[性能报告] 知识点加载时间: ${this.knowledgeLoadTime}ms`);

        // 内存使用报告
        const memory = this.getMemoryUsage();
        if (memory) {
          console.log(`[内存报告] JS堆大小限制: ${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`);
          console.log(`[内存报告] 总JS堆大小: ${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
          console.log(`[内存报告] 已用JS堆大小: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
        }
        const info = wx.getStorageInfoSync();
        this.storageQuotaUsage = info.currentSize / info.limitSize;
        console.log(`[内存报告] storageQuotaUsage: ${this.storageQuotaUsage}`);
      }
    }
  };

  // 使用LRU缓存
  const groupCache = new LRUCache(100); // 分组缓存容量
  const knowledgeCache = new LRUCache(500); // 知识点缓存容量

  // mockStorage 适配：仅在 Node 测试环境下生效
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  const mockStorage = {};

  function getStorageSync(key) {
    if (isNode) return mockStorage[key];
    return wx.getStorageSync(key);
  }
  function setStorageSync(key, value) {
    if (isNode) { mockStorage[key] = value; return; }
    wx.setStorageSync(key, value);
  }
  function removeStorageSync(key) {
    if (isNode) { delete mockStorage[key]; return; }
    wx.removeStorageSync(key);
  }

  // perfGetStorageSync/perfSetStorageSync/perfRemoveStorageSync 也全部用上述包装
  function perfGetStorageSync(key) {
    const start = Date.now();
    perfMetrics.storageReads++;
    const result = getStorageSync(key);
    perfMetrics.storageReadTime += Date.now() - start;
    return result;
  }
  function perfSetStorageSync(key, value) {
    const start = Date.now();
    perfMetrics.storageWrites++;
    setStorageSync(key, value);
    perfMetrics.storageWriteTime += Date.now() - start;
  }
  function perfRemoveStorageSync(key) {
    const start = Date.now();
    perfMetrics.storageWrites++;
    removeStorageSync(key);
    perfMetrics.storageWriteTime += Date.now() - start;
  }

  const defaultSettings = {
    batchSize: 20,
    efactor: 2.5, // 新增：全局默认efactor
    groupEfactorMap: {}, // 新增：分组efactor映射
    enablePerfLogging: true // 默认启用性能日志
  };

  function getSettings() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && app.globalData.settings) {
      return { ...defaultSettings, ...app.globalData.settings };
    }
    const settings = perfGetStorageSync('app_settings');
    const merged = settings ? { ...defaultSettings, ...settings } : defaultSettings;

    if (app && app.globalData) app.globalData.settings = merged;
    return merged;
  }

  function saveSettings(settings) {
    perfSetStorageSync('app_settings', settings);
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) app.globalData.settings = settings;
  }
  function restoreSettings() {
    saveSettings(defaultSettings);
  }

  // 公共函数：只同步全局变量，不做本地存储
  function setGlobalGroups(groups) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      // Node环境下不做任何事，仅仅测试用
      return;
    }
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && app.globalData) app.globalData.groups = groups;
    }
  }
  // --- Group Functions ---
  function getAllGroups() {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const groups = perfGetStorageSync('groups') || [];
      return groups;
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && Array.isArray(app.globalData.groups) && app.globalData.groups.length > 0) {
      return app.globalData.groups;
    }
    const groups = perfGetStorageSync('groups') || [];
    if (groups) setGlobalGroups(groups);
    return groups;
  }

  function addGroup(groupName) {
    try {
      let groups = getAllGroups();
      const newGroup = {
        id: getNextId('nextGroupId'),
        name: groupName,
        knowledgeCount: 0,
        learnedCount: 0,
        masteredCount: 0,
        unmasteredCount: 0,
        unlearnedCount: 0,
        dueCount: 0,
        createTime: Date.now()
      };
      groups.push(newGroup);
      perfSetStorageSync('groups', groups);
      setGlobalGroups(groups);
      // 为新组创建一个空的知识点索引
      perfSetStorageSync(`group-${newGroup.id}`, []);

      return newGroup;
    } catch (error) {
      console.error('addGroup failed:', error);
      if (typeof wx !== 'undefined' && wx.showToast) {
        wx.showToast({
          title: '添加分组失败',
          icon: 'none'
        });
      }
      throw error;
    }
  }

  // 辅助函数：获取下一个ID
  function getNextId(key) {
    try {
      let nextId = perfGetStorageSync(key) || 1;
      perfSetStorageSync(key, nextId + 1);
      return nextId;
    } catch (error) {
      console.error(`getNextId failed for key ${key}:`, error);
      throw new Error('ID_GENERATION_FAILED');
    }
  }

  function updateGroup(groupToUpdate) {
    let groups = getAllGroups();
    const index = groups.findIndex(g => g.id === groupToUpdate.id);
    if (index !== -1) {
      groups[index].name = groupToUpdate.name;
      perfSetStorageSync('groups', groups);
      setGlobalGroups(groups);
    }
  }

  function removeGroup(groupId) {
    // 1. 从分组列表中移除
    let groups = getAllGroups();
    const updatedGroups = groups.filter(g => g.id !== groupId);
    perfSetStorageSync('groups', updatedGroups);
    setGlobalGroups(updatedGroups);
    // 2. 删除该分组下的所有知识点详情
    const groupKey = `group-${groupId}`;
    const knowledgeIds = perfGetStorageSync(groupKey) || [];
    knowledgeIds.forEach(id => {
      perfRemoveStorageSync(`knowledge-${id}`);
      clearCache('knowledge', id);
    });
    // 3. 删除分组索引本身
    perfRemoveStorageSync(groupKey);
    // 缓存同步：清除分组缓存
    clearCache('group', groupId);
  }

  // --- Knowledge Functions ---
  function getGroupKnowledgeIds(groupId) {
    // 优先查 groupCache
    const cachedIds = groupCache.get(groupId);
    if (cachedIds) {
      perfMetrics.groupCacheHits++;
      return cachedIds;
    }
    perfMetrics.groupCacheMisses++;
    let ids = perfGetStorageSync(`group-${groupId}`) || [];
    
    // 在测试环境中，确保从mockStorage中获取最新数据
    if (isNode && (!ids || ids.length === 0) && mockStorage[`group-${groupId}`]) {
      ids = mockStorage[`group-${groupId}`];
    }
    
    groupCache.set(groupId, ids);
    return ids ? [...ids] : [];
  }

  // --- 缓存管理函数 ---
  function getGroupDataCached(groupId, options = {}) {
    const { limit, offset = 0, filter } = options;
    const ids = getGroupKnowledgeIds(groupId);
    
    // 如果指定了limit，只加载部分数据
    const targetIds = limit ? ids.slice(offset, offset + limit) : ids;
    
    const result = targetIds.map(id => {
      const knowledge = getKnowledgeByIdCached(id);
      return knowledge;
    }).filter(Boolean);
    
    // 缓存预热：如果请求的是第一页数据，预加载下一页
    if (limit && offset === 0 && ids.length > limit) {
      // 在下一个事件循环中预加载下一页数据
      setTimeout(() => {
        const nextPageIds = ids.slice(limit, limit * 2);
        nextPageIds.forEach(id => getKnowledgeByIdCached(id));
      }, 50);
    }
    
    // 如果有过滤函数，应用过滤
    return filter ? result.filter(filter) : result;
  }

  // 新增：异步获取分组数据
  function getGroupDataAsync(groupId) {
    return new Promise((resolve) => {
      // 在测试环境中，直接使用同步方法
      if (isNode) {
        const result = getGroupDataCached(groupId) || [];
        resolve(result);
        return;
      }
      
      const groupKey = `group-${groupId}`;
      wx.getStorage({
        key: groupKey,
        success: (res) => {
          const knowledgeIds = res.data || [];
          // 并行异步获取所有知识点
          const promises = knowledgeIds.map(id =>
            new Promise(resolveItem => {
              wx.getStorage({
                key: `knowledge-${id}`,
                success: (kRes) => resolveItem(kRes.data),
                fail: () => resolveItem(null)
              });
            })
          );
          Promise.all(promises).then(knowledgeList => {
            resolve(knowledgeList.filter(item => item !== null));
          });
        },
        fail: () => resolve([])
      });
    });
  }

  // 公共方法：统计分组各类数量
  function calcGroupStats(allKnowledge, todayReviewList) {
    // 确保allKnowledge是数组
    if (!Array.isArray(allKnowledge)) {
      console.error('calcGroupStats: allKnowledge不是数组', allKnowledge);
      allKnowledge = [];
    }

    
    const knowledgeCount = allKnowledge.length;
    const learnedList = allKnowledge.filter(k => k && k.learned === true);
    const learnedCount = learnedList.length;
    const unlearnedCount = knowledgeCount - learnedCount;
    const masteredList = learnedList.filter(k => k && k.status === 'mastered');
    const masteredCount = masteredList.length;
    const unmasteredCount = learnedCount - masteredCount;
    const dueCount = (todayReviewList || []).filter(k => k && k.nextReviewTime <= Date.now()).length;

    
    return { knowledgeCount, learnedCount, unlearnedCount, masteredCount, unmasteredCount, dueCount };
  }
  function updateGroupStats(groupId) {
    const groups = getAllGroups();
    const idx = groups.findIndex(g => g.id == groupId);
    if (idx === -1) {
      return;
    }

    // 获取当前统计信息的快照
    const oldStats = {
      knowledgeCount: groups[idx].knowledgeCount || 0,
      learnedCount: groups[idx].learnedCount || 0,
      masteredCount: groups[idx].masteredCount || 0,
      unlearnedCount: groups[idx].unlearnedCount || 0,
      unmasteredCount: groups[idx].unmasteredCount || 0,
      dueCount: groups[idx].dueCount || 0
    };

    // 清除缓存，确保获取最新数据
    clearCache('group', groupId);
    
    // 全量统计刷新
    const todayReviewList = getTodayReviewList(groupId);
    const allKnowledge = getGroupDataCached(groupId) || [];
    const stats = calcGroupStats(allKnowledge, todayReviewList);
    
    // 检查统计信息是否有变化
    const hasChanges = 
      oldStats.knowledgeCount !== stats.knowledgeCount ||
      oldStats.learnedCount !== stats.learnedCount ||
      oldStats.masteredCount !== stats.masteredCount ||
      oldStats.unlearnedCount !== stats.unlearnedCount ||
      oldStats.unmasteredCount !== stats.unmasteredCount ||
      oldStats.dueCount !== stats.dueCount;
    
    // 只有在统计信息有变化时才更新
    if (hasChanges) {
      groups[idx].knowledgeCount = stats.knowledgeCount;
      groups[idx].dueCount = stats.dueCount;
      groups[idx].learnedCount = stats.learnedCount;
      groups[idx].unlearnedCount = stats.unlearnedCount;
      groups[idx].masteredCount = stats.masteredCount;
      groups[idx].unmasteredCount = stats.unmasteredCount;
      
      // 确保在测试环境中也能正确更新统计数据
      perfSetStorageSync('groups', groups); // 保证mockStorage同步
      if (isNode) {
        mockStorage['groups'] = groups;
      }
      setGlobalGroups(groups); // 兼容小程序端
    }
  }

  // 学习的时候缓存下来，复习的时候就可以用了，小程序销毁时失效
  function getKnowledgeByIdCached(id) {
    if (typeof id === 'undefined') return null;

    const cached = knowledgeCache.get(id);
    if (cached) {
      perfMetrics.knowledgeCacheHits++;
      return cached ? Object.assign({}, cached) : cached;
    }

    perfMetrics.knowledgeCacheMisses++;
    let data = perfGetStorageSync(`knowledge-${id}`) || null;
    
    // 在测试环境中，确保从mockStorage中获取最新数据
    if (isNode && !data && mockStorage[`knowledge-${id}`]) {
      data = mockStorage[`knowledge-${id}`];
    }
    
    if (data) {
      knowledgeCache.set(id, data);
      return Object.assign({}, data);
    }
    return data;
  }

  // 通用分页函数
  function getPagedKnowledge(groupId, filterFn, page = 1, pageSize = 20) {
    const allIds = getGroupKnowledgeIds(groupId);
    const result = [];
    let count = 0;
    let collected = 0;
    for (let i = 0; i < allIds.length; i++) {
      const k = getKnowledgeByIdCached(allIds[i]);
      if (filterFn(k)) {
        count++;
        if (count > (page - 1) * pageSize && collected < pageSize) {
          result.push(k);
          collected++;
        }
        if (collected >= pageSize) break;
      }
    }
    return result;
  }

  function getUnlearnedPaged(groupId, page = 1, pageSize = 20) {
    return getPagedKnowledge(groupId, k => k && !k.learned, page, pageSize);
  }

  function getMasteredPaged(groupId, page = 1, pageSize = 20) {
    return getPagedKnowledge(groupId, k => k && k.learned === true && k.status === 'mastered', page, pageSize);
  }
  // 分页/条件展示：用 getPagedKnowledge。
  // 全量统计/遍历：用 getGroupDataCached。

  function getMasteredCount(groupId) {
    const allKnowledge = getGroupDataCached(groupId) || [];
    return allKnowledge.filter(k => k.learned === true && k.status === 'mastered').length;
  }

  // 分块处理函数
  async function processInChunks(items, processFn, chunkSize = 50) {
    const total = items.length;
    let processed = 0;
    
    while (processed < total) {
      const startTime = Date.now();
      const maxTimePerChunk = 16; // 每块最大处理时间（毫秒）
      
      // 处理当前块
      const chunk = items.slice(processed, processed + chunkSize);
      await Promise.all(chunk.map(processFn));
      processed += chunk.length;
      
      // 如果还有更多数据要处理，并且已经处理了足够长的时间，让出主线程
      if (processed < total && (Date.now() - startTime > maxTimePerChunk)) {
        // 使用setTimeout让UI有机会更新
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  async function addKnowledgeBatchToGroup(groupId, knowledgeBatch) {
    if (!knowledgeBatch || knowledgeBatch.length === 0) {
      const group = getAllGroups().find(g => g.id === groupId);
      return {
        newIds: [],
        finalKnowledgeCount: group ? group.knowledgeCount : 0
      };
    }

    const groupKey = `group-${groupId}`;
    let knowledgeIds = getGroupKnowledgeIds(groupId);
    let nextId = perfGetStorageSync('nextKnowledgeId') || 1;

    const newIds = [];
    // 分块处理避免UI阻塞
    await processInChunks(knowledgeBatch, async (knowledge) => {
      const newKnowledgeId = nextId;
      knowledge.id = newKnowledgeId;
      knowledge.media = knowledge.media || [];
      knowledge.addTime = knowledge.addTime || Date.now();
      // 保持未学会知识点无 nextReviewTime，仅 learned=true 时由 markLearned 逻辑赋值
      knowledge.learned = typeof knowledge.learned === 'boolean' ? knowledge.learned : false;
      perfSetStorageSync(`knowledge-${newKnowledgeId}`, knowledge);
      newIds.push(newKnowledgeId);
      nextId++;
    });

    perfSetStorageSync('nextKnowledgeId', nextId);

    const updatedIds = knowledgeIds.concat(newIds);
    perfSetStorageSync(groupKey, updatedIds); //需要清空缓存    
    // 缓存同步：清除分组缓存
    clearCache && clearCache('group', groupId);

    // 更新分组统计
    updateGroupStats(groupId);

    let groups = getAllGroups();
    const groupIndex = groups.findIndex(g => g.id == groupId);
    if (groupIndex !== -1) {
      // 更新全本地groups
      groups[groupIndex].knowledgeCount = updatedIds.length;
      perfSetStorageSync('groups', groups);
    }

    return {
      newIds,
      finalKnowledgeCount: updatedIds.length
    };
  }


  function clearCache(type, id) {
    if (type === 'group' && id) groupCache.delete(id);
    if (type === 'knowledge' && id) knowledgeCache.delete(id);
    if (type === 'all') {
      groupCache.clear();
      knowledgeCache.clear();
    }
  }


  function reportPerf() {
    perfMetrics.report();
  }

  // 防抖函数：避免短时间内多次调用
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  // 公共方法：批量刷新所有分组统计
  async function refreshAllGroupStatsCore() {
    try {
      await refreshAllReviewListsAsync();
      const allGroups = getAllGroups();
      for (let i = 0; i < allGroups.length; i++) {
        await new Promise(resolve => setTimeout(() => {
          updateGroupStats(allGroups[i].id);
          resolve();
        }, 0));
      }
      // 确保在测试环境中也能正确更新统计数据
      const updatedGroups = getAllGroups();
      perfSetStorageSync('groups', updatedGroups);
      if (isNode) {
        // 直接使用已经更新的groups，不需要重新计算
        mockStorage['groups'] = updatedGroups;
      }
    } catch (error) {
      console.error('[refreshAllGroupStats] 执行出错:', error);
    }
  }
  
  // 防抖包装的刷新函数，300ms内的多次调用会合并为一次
  const refreshAllGroupStats = debounce(refreshAllGroupStatsCore, 300);



  // 核心复用逻辑，支持同步和异步
  async function refreshAllReviewListsCore(asyncMode = false) {
    const allGroups = getAllGroups();
    const settings = getSettings();
    const batchSize = settings.batchSize || 20;
    
    // 记录哪些分组有变化
    const changedGroupIds = new Set();

    for (const g of allGroups) {
      resetTodayReviewListIfNeeded(g.id);
      let allKnowledge;
      if (asyncMode) {
        // 优先用缓存
        const cachedIds = groupCache.get(g.id);
        if (cachedIds) {
          allKnowledge = cachedIds.map(id => getKnowledgeByIdCached(id)).filter(Boolean);
        } else {
          allKnowledge = await getGroupDataAsync(g.id);
        }
      } else {
        allKnowledge = getGroupDataCached(g.id) || [];
      }
      const now = Date.now();
      const dueArr = allKnowledge.filter(k => k.learned === true && k.status !== 'mastered' && k.nextReviewTime <= now);
      // const ids = dueArr.slice(0, batchSize).map(k => k.id); // 如需分页
      const ids = dueArr.map(k => k.id);
      
      // 获取当前保存的复习列表
      const key = `todayReviewList-${g.id}`;
      const currentCache = perfGetStorageSync(key);
      const currentIds = (currentCache && currentCache.date === getTodayStr() && Array.isArray(currentCache.ids)) ? currentCache.ids : [];
      
      // 检查复习列表是否有变化
      let hasChanges = currentIds.length !== ids.length;
      if (!hasChanges) {
        // 检查内容是否有变化
        const currentSet = new Set(currentIds);
        hasChanges = ids.some(id => !currentSet.has(id));
      }
      
      // 只有在复习列表有变化时才更新
      if (hasChanges) {
        if (asyncMode && !isNode) {
          await new Promise(resolve => {
            wx.setStorage({
              key: key,
              data: { date: getTodayStr(), ids },
              success: () => resolve(),
              fail: resolve
            });
          });
        } else {
          perfSetStorageSync(key, { date: getTodayStr(), ids });
        }
        
        // 标记分组已更改
        changedGroupIds.add(g.id);
        
        // 只更新 dueCount 字段
        const app = typeof getApp === 'function' ? getApp() : null;
        if (app && app.globalData && Array.isArray(app.globalData.groups)) {
          const groups = app.globalData.groups;
          const idx = groups.findIndex(group => group.id == g.id);
          if (idx !== -1) {
            groups[idx].dueCount = dueArr.length;
          }
        }
      }
    }
    
    // 只有在有分组变化时才保存所有分组
    if (changedGroupIds.size > 0) {
      perfSetStorageSync('groups', getAllGroups());
    }
  }

  // 同步刷新（兼容老接口）
  function refreshAllReviewLists() {
    refreshAllReviewListsCore(false);
  }

  // 异步刷新
  async function refreshAllReviewListsAsync() {
    await refreshAllReviewListsCore(true);
  }
  // 日期变更时重置今日批次
  /**
   * 检查并重置当天的复习列表缓存（如果需要）
   * 
   * 根据当前日期判断缓存是否过期，若过期则清除对应群组的缓存数据
   * 
   * @param {string} groupId - 群组ID，用于构建存储键名
   */
  function resetTodayReviewListIfNeeded(groupId) {
    const key = `todayReviewList-${groupId}`;
    const today = getTodayStr();
    let cache = perfGetStorageSync(key);
    if (!cache || cache.date !== today) {
      perfRemoveStorageSync(key);
    }
  }

  // 获取当天日期字符串
  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // 获取/生成今日复习批次（最多20条），只推送到期（now >= nextReviewTime）的知识点
  function getTodayReviewList(groupId, page = 1, pageSize = 20) {
    const key = `todayReviewList-${groupId}`;
    const cache = perfGetStorageSync(key);
    const ids = (cache && cache.date === getTodayStr() && Array.isArray(cache.ids)) ? cache.ids : [];
    // 兼容老代码：如果未传 page/pageSize，返回全部
    if (arguments.length === 1) {
      return ids.map(id => getKnowledgeByIdCached(id)).filter(Boolean);
    }
    // 只查当前页
    const result = [];
    let count = 0;
    let collected = 0;
    for (let i = 0; i < ids.length; i++) {
      const k = getKnowledgeByIdCached(ids[i]);
      if (k) {
        count++;
        if (count > (page - 1) * pageSize && collected < pageSize) {
          result.push(k);
          collected++;
        }
        if (collected >= pageSize) break;
      }
    }
    return result;
  }

  // 获取今日待复习数量
  function getDueCount(groupId) {
    return getTodayReviewList(groupId).length;
  }

  // SM-2算法实现
  function updateKnowledgeBySM2(knowledge, quality) {
    // quality: 0-5，5为完全记住，3为勉强记住，0为完全忘记
    if (typeof knowledge.efactor !== 'number') knowledge.efactor = 2.5;
    if (typeof knowledge.interval !== 'number') knowledge.interval = 0;
    if (typeof knowledge.repetition !== 'number') knowledge.repetition = 0;

    if (quality < 3) {
      // 回归初始，间隔重置为5分钟
      knowledge.repetition = 0;
      knowledge.interval = 5 / (24 * 60); // 5分钟，单位天
      knowledge.status = 'pending'; // 状态降级
    } else {
      knowledge.repetition += 1;
      if (knowledge.repetition === 1) {
        knowledge.interval = 5 / (24 * 60); // 5分钟
      } else if (knowledge.repetition === 2) {
        knowledge.interval = 30 / (24 * 60); // 30分钟
      } else if (knowledge.repetition === 3) {
        knowledge.interval = 0.5; // 12小时
      } else if (knowledge.repetition === 4) {
        knowledge.interval = 1; // 1天
      } else if (knowledge.repetition === 5) {
        knowledge.interval = 6; // 6天
      } else {
        knowledge.interval = Math.round(knowledge.interval * knowledge.efactor);
      }
    }
    // 更新efactor
    knowledge.efactor = knowledge.efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (knowledge.efactor < 1.3) knowledge.efactor = 1.3;

    // 计算下次复习时间
    knowledge.nextReviewTime = Date.now() + knowledge.interval * 24 * 60 * 60 * 1000;

    // 记录历史
    if (!Array.isArray(knowledge.history)) knowledge.history = [];
    knowledge.history.push({
      time: Date.now(),
      quality,
      interval: knowledge.interval,
      efactor: knowledge.efactor
    });

    return knowledge;
  }

  function saveKnowledge(knowledge, skipStatsUpdate = false) {
    if (!knowledge || typeof knowledge.id === 'undefined') {
      console.error('saveKnowledge failed: knowledge or knowledge.id is missing', knowledge);
      return;
    }
    // 先取旧的
    const key = `knowledge-${knowledge.id}`;
    const prev = perfGetStorageSync(key);

    // 再写新的
    perfSetStorageSync(key, knowledge);
    // 确保在测试环境中也更新mockStorage
    if (isNode) {
      mockStorage[key] = knowledge;
    }
    clearCache('knowledge', knowledge.id);

    // 检查是否需要更新统计
    if (skipStatsUpdate) {
      return; // 跳过统计更新
    }

    // 检查是否有关键状态变化需要更新统计
    const hasStatusChange = !prev || 
                           (prev.learned !== knowledge.learned) || 
                           (prev.status !== knowledge.status) ||
                           (prev.nextReviewTime !== knowledge.nextReviewTime);
    
    if (!hasStatusChange) {
      return; // 没有关键状态变化，不需要更新统计
    }

    // 增量统计
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && Array.isArray(app.globalData.groups)) {
      const groups = app.globalData.groups;
      const idx = groups.findIndex(g => g.id == knowledge.groupId);

      if (idx !== -1) {
        const now = Date.now();
        // 初始化统计字段，防止undefined
        if (typeof groups[idx].learnedCount !== 'number') groups[idx].learnedCount = 0;
        if (typeof groups[idx].masteredCount !== 'number') groups[idx].masteredCount = 0;
        if (typeof groups[idx].unlearnedCount !== 'number') groups[idx].unlearnedCount = 0;
        if (typeof groups[idx].unmasteredCount !== 'number') groups[idx].unmasteredCount = 0;
        if (typeof groups[idx].dueCount !== 'number') groups[idx].dueCount = 0;
        if (typeof groups[idx].knowledgeCount !== 'number') groups[idx].knowledgeCount = 0;
        // learnedCount
        if (!prev && knowledge.learned) groups[idx].learnedCount += 1;
        else if (prev && !prev.learned && knowledge.learned) groups[idx].learnedCount += 1;
        else if (prev && prev.learned && !knowledge.learned) groups[idx].learnedCount -= 1;
        // masteredCount
        if (!prev && knowledge.status === 'mastered') groups[idx].masteredCount += 1;
        else if (prev && prev.status !== 'mastered' && knowledge.status === 'mastered') groups[idx].masteredCount += 1;
        else if (prev && prev.status === 'mastered' && knowledge.status !== 'mastered') groups[idx].masteredCount -= 1;
        // unlearnedCount
        groups[idx].unlearnedCount = groups[idx].knowledgeCount - groups[idx].learnedCount;
        // unmasteredCount
        groups[idx].unmasteredCount = groups[idx].learnedCount - groups[idx].masteredCount;
        // dueCount
        const prevDue = prev && prev.learned && prev.status !== 'mastered' && prev.nextReviewTime <= now;
        const currDue = knowledge.learned && knowledge.status !== 'mastered' && knowledge.nextReviewTime <= now;
        if (!prevDue && currDue) groups[idx].dueCount += 1;
        else if (prevDue && !currDue) groups[idx].dueCount -= 1;
        perfSetStorageSync('groups', groups);
      }
    } else if (isNode) {
      // 在测试环境中，直接更新统计数据
      let groups = getAllGroups();
      const idx = groups.findIndex(g => g.id == knowledge.groupId);
      if (idx !== -1) {
        const now = Date.now();
        // 初始化统计字段，防止undefined
        if (typeof groups[idx].learnedCount !== 'number') groups[idx].learnedCount = 0;
        if (typeof groups[idx].masteredCount !== 'number') groups[idx].masteredCount = 0;
        if (typeof groups[idx].unlearnedCount !== 'number') groups[idx].unlearnedCount = 0;
        if (typeof groups[idx].unmasteredCount !== 'number') groups[idx].unmasteredCount = 0;
        if (typeof groups[idx].dueCount !== 'number') groups[idx].dueCount = 0;
        if (typeof groups[idx].knowledgeCount !== 'number') groups[idx].knowledgeCount = 0;
        // learnedCount
        if (!prev && knowledge.learned) groups[idx].learnedCount += 1;
        else if (prev && !prev.learned && knowledge.learned) groups[idx].learnedCount += 1;
        else if (prev && prev.learned && !knowledge.learned) groups[idx].learnedCount -= 1;
        // masteredCount
        if (!prev && knowledge.status === 'mastered') groups[idx].masteredCount += 1;
        else if (prev && prev.status !== 'mastered' && knowledge.status === 'mastered') groups[idx].masteredCount += 1;
        else if (prev && prev.status === 'mastered' && knowledge.status !== 'mastered') groups[idx].masteredCount -= 1;
        // unlearnedCount
        groups[idx].unlearnedCount = groups[idx].knowledgeCount - groups[idx].learnedCount;
        // unmasteredCount
        groups[idx].unmasteredCount = groups[idx].learnedCount - groups[idx].masteredCount;
        // dueCount
        const prevDue = prev && prev.learned && prev.status !== 'mastered' && prev.nextReviewTime <= now;
        const currDue = knowledge.learned && knowledge.status !== 'mastered' && knowledge.nextReviewTime <= now;
        if (!prevDue && currDue) groups[idx].dueCount += 1;
        else if (prevDue && !currDue) groups[idx].dueCount -= 1;
        
        // 保存更新后的分组数据
        mockStorage['groups'] = groups;
        perfSetStorageSync('groups', groups);
      } else {
        // 如果找不到分组，则全量更新
        clearCache('knowledge', knowledge.id);
        updateGroupStats(knowledge.groupId);
        const updatedGroups = getAllGroups();
        mockStorage['groups'] = updatedGroups;
        perfSetStorageSync('groups', updatedGroups);
      }
    } else {
      // 非测试环境，全量更新
      clearCache('knowledge', knowledge.id);
      updateGroupStats(knowledge.groupId); // 同步更新全局变量
      const updatedGroups = getAllGroups();
      perfSetStorageSync('groups', updatedGroups); // 保存到本地
    }
  }

  function removeKnowledge(groupId, knowledgeId) {
    // 获取被删除知识点状态（用于更新统计）
    const knowledge = getKnowledgeByIdCached(knowledgeId);

    // 1. 从知识点详情中删除
    perfRemoveStorageSync(`knowledge-${knowledgeId}`);

    // 2. 从分组索引中删除
    const groupKey = `group-${groupId}`;
    let knowledgeIds = perfGetStorageSync(groupKey) || [];
    knowledgeIds = knowledgeIds.filter(id => id !== knowledgeId);
    perfSetStorageSync(groupKey, knowledgeIds);
    // 缓存同步：只清除必要的缓存
    clearCache('knowledge', knowledgeId);
    // 只清除分组缓存，不做全量清理
    clearCache('group', groupId);

    // 3. 更新分组列表中的知识点数量和统计
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && Array.isArray(app.globalData.groups)) {
      const groups = app.globalData.groups;
      const groupIndex = groups.findIndex(g => g.id == groupId);
      if (groupIndex > -1) {
        groups[groupIndex].knowledgeCount = knowledgeIds.length;
        // 初始化统计字段
        if (typeof groups[groupIndex].learnedCount !== 'number') groups[groupIndex].learnedCount = 0;
        if (typeof groups[groupIndex].masteredCount !== 'number') groups[groupIndex].masteredCount = 0;
        if (typeof groups[groupIndex].unlearnedCount !== 'number') groups[groupIndex].unlearnedCount = 0;
        if (typeof groups[groupIndex].unmasteredCount !== 'number') groups[groupIndex].unmasteredCount = 0;
        if (typeof groups[groupIndex].dueCount !== 'number') groups[groupIndex].dueCount = 0;
        // 增量统计
        const now = Date.now();
        if (knowledge) {
          if (knowledge.learned) groups[groupIndex].learnedCount -= 1;
          if (knowledge.status === 'mastered') groups[groupIndex].masteredCount -= 1;
          // dueCount
          const prevDue = knowledge.learned && knowledge.status !== 'mastered' && knowledge.nextReviewTime <= now;
          if (prevDue) groups[groupIndex].dueCount -= 1;
        }
        // unlearnedCount
        groups[groupIndex].unlearnedCount = groups[groupIndex].knowledgeCount - groups[groupIndex].learnedCount;
        // unmasteredCount
        groups[groupIndex].unmasteredCount = groups[groupIndex].learnedCount - groups[groupIndex].masteredCount;
        perfSetStorageSync('groups', groups);
      }
    } else {
      // 只在必要时更新分组统计
      updateGroupStats(groupId);
      perfSetStorageSync('groups', getAllGroups());
    }
  }


  // 不要在 IIFE 内部挂载 perfMetrics
  return {
    getAllGroups,
    addGroup,
    updateGroup,
    removeGroup,
    getGroupDataAsync,
    saveKnowledge,
    removeKnowledge,
    addKnowledgeBatchToGroup,
    getTodayReviewList,
    resetTodayReviewListIfNeeded,
    updateKnowledgeBySM2,
    restoreSettings,
    getSettings,
    saveSettings,
    refreshAllReviewLists,
    refreshAllReviewListsAsync,
    getGroupDataCached,
    getKnowledgeByIdCached,
    clearCache,
    getUnlearnedPaged,
    getMasteredCount,
    getMasteredPaged,
    updateGroupStats,
    // 新增公共方法
    calcGroupStats,
    refreshAllGroupStats,
    perfSetStorageSync,
    perfGetStorageSync,
    // 暴露给测试的内部方法
    _getNextId: getNextId,
    _updateKnowledgeBySM2: updateKnowledgeBySM2,
    _getGroupDataDirect: (groupId) => perfGetStorageSync(`group-${groupId}`) || [],
    getDueCount,
    reportPerf,
    _mockStorage: mockStorage, // 供测试用例直接访问
    perfMetrics // 新增：暴露性能指标对象
  };
})();

module.exports = GroupManager;