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

  const defaultSettings = {
    batchSize: 20,
    efactor: 2.5, // 新增：全局默认efactor
    groupEfactorMap: {}, // 新增：分组efactor映射
    enablePerfLogging: true // 默认启用性能日志
  };

  function getDefaultSettings() {
    return JSON.parse(JSON.stringify(defaultSettings));
  }

  function getSettings() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && app.globalData.settings) {
      return { ...getDefaultSettings(), ...app.globalData.settings };
    }
    const settings = wx.getStorageSync('app_settings');
    const merged = settings ? { ...getDefaultSettings(), ...settings } : getDefaultSettings();

    if (app && app.globalData) app.globalData.settings = merged;
    return merged;
  }

  function saveSettings(settings) {
    wx.setStorageSync('app_settings', settings);
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData) app.globalData.settings = settings;
  }
  // 公共方法：批量获取知识点对象
  function getKnowledgeListByIds(ids) {
    return (ids || []).map(id => getKnowledgeById(id)).filter(Boolean);
  }

  // 公共方法：统计分组各类数量
  function calcGroupStats(allKnowledge, todayReviewList) {
    const learnedList = allKnowledge.filter(k => k.learned === true);
    const learnedCount = learnedList.length;
    const masteredCount = learnedList.filter(k => k.status === 'mastered').length;
    const unmasteredCount = learnedCount - masteredCount;
    const dueCount = (todayReviewList || []).filter(k => k && k.nextReviewTime <= Date.now()).length;
    return { learnedCount, masteredCount, unmasteredCount, dueCount };
  }

  // 公共方法：批量刷新所有分组统计
  function refreshAllGroupStats() {
    const allGroups = getAllGroups();
    allGroups.forEach(g => updateGroupStats(g.id));
  }

  // --- Group Functions ---
  function getAllGroups() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && app.globalData && Array.isArray(app.globalData.groups) && app.globalData.groups.length > 0) {
      return app.globalData.groups;
    }
    // 全局变量为空时从本地存储同步
    const groups = wx.getStorageSync('groups') || [];
    if (app && app.globalData) app.globalData.groups = groups;
    return groups;
  }

  function addGroup(groupName) {
    try {
      let groups = getAllGroups();
      const newGroup = {
        id: getNextId('nextGroupId'),
        name: groupName,
        knowledgeCount: 0,
        createTime: Date.now()
      };
      groups.push(newGroup);
      wx.setStorageSync('groups', groups);
      // 更新全局groups
      if (typeof getApp === 'function') getApp().globalData.groups = groups;
      // 为新组创建一个空的知识点索引
      wx.setStorageSync(`group-${newGroup.id}`, []);
      // 缓存同步：清除分组缓存
      clearCache && clearCache('group', newGroup.id);
      return newGroup;
    } catch (error) {
      console.error('addGroup failed:', error);
      wx.showToast({
        title: '添加分组失败',
        icon: 'none'
      });
      throw error;
    }
  }

  // 辅助函数：获取下一个ID
  function getNextId(key) {
    try {
      let nextId = wx.getStorageSync(key) || 1;
      wx.setStorageSync(key, nextId + 1);
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
      wx.setStorageSync('groups', groups);
      // 更新全局groups
      if (typeof getApp === 'function') getApp().globalData.groups = groups;
    }
  }

  function removeGroup(groupId) {
    // 1. 从分组列表中移除
    let groups = getAllGroups();
    const updatedGroups = groups.filter(g => g.id !== groupId);
    wx.setStorageSync('groups', updatedGroups);
    // 更新全局groups
    if (typeof getApp === 'function') getApp().globalData.groups = updatedGroups;
    // 2. 删除该分组下的所有知识点详情
    const groupKey = `group-${groupId}`;
    const knowledgeIds = wx.getStorageSync(groupKey) || [];
    knowledgeIds.forEach(id => {
      wx.removeStorageSync(`knowledge-${id}`);
    });
    // 3. 删除分组索引本身
    wx.removeStorageSync(groupKey);
    // 缓存同步：清除分组缓存
    clearCache && clearCache('group', groupId);
  }

  // --- Knowledge Functions ---

  // 同步获取分组数据（保持兼容）
  function getGroupData(groupId) {
    return getGroupDataCached(groupId);
  }

  // --- 缓存管理函数 ---
  function getGroupDataCached(groupId) {
    const cached = groupCache.get(groupId);
    if (cached) {
      perfMetrics.groupCacheHits++;
      return cached;
    }
    perfMetrics.groupCacheMisses++;
    // 直接获取原始数据，避免递归调用
    const data = wx.getStorageSync(`group-${groupId}`) || [];
    const knowledges = getKnowledgeListByIds(data);
    if (knowledges) groupCache.set(groupId, knowledges);
    return knowledges;
  }

  // 新增：异步获取分组数据
  function getGroupDataAsync(groupId) {
    return new Promise((resolve) => {
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

  function updateGroupStats(groupId, statsDelta = {}) {
    // 只维护app.globalData.groups
    const groups = getAllGroups();
    const idx = groups.findIndex(g => g.id == groupId);
    if (idx === -1) return;
    // 增量更新（如有）
    if (statsDelta && Object.keys(statsDelta).length > 0) {
      for (const [key, delta] of Object.entries(statsDelta)) {
        groups[idx][key] = (groups[idx][key] || 0) + delta;
      }
    }
    // 全量统计刷新
    const todayReviewList = getTodayReviewList(groupId);
    const allKnowledge = getGroupData(groupId) || [];
    const stats = calcGroupStats(allKnowledge, todayReviewList);
    groups[idx].dueCount = stats.dueCount;
    groups[idx].learnedCount = stats.learnedCount;
    groups[idx].unLearnedCount = groups[idx].knowledgeCount - stats.learnedCount;
    groups[idx].masteredCount = stats.masteredCount;
    groups[idx].unmasteredCount = stats.unmasteredCount;
    wx.setStorageSync('groups', groups);
    if (typeof getApp === 'function') getApp().globalData.groups = groups;
  }

  // 辅助函数：增量更新分组统计（已废弃groupStats，仅操作groups）
  function incrementGroupStat(groupId, statName, delta) {
    const groups = getAllGroups();
    const idx = groups.findIndex(g => g.id == groupId);
    if (idx === -1) return;
    groups[idx][statName] = (groups[idx][statName] || 0) + delta;
    wx.setStorageSync('groups', groups);
    if (typeof getApp === 'function') getApp().globalData.groups = groups;
  }

  // 在知识点变动时自动更新分组统计
  function saveKnowledge(knowledge) {
    if (!knowledge || typeof knowledge.id === 'undefined') {
      console.error('saveKnowledge failed: knowledge or knowledge.id is missing', knowledge);
      return;
    }

    const prev = getKnowledgeById(knowledge.id);
    const statsDelta = {};

    // 计算统计变化
    if (prev) {
      // 学习状态变化
      if (!prev.learned && knowledge.learned) {
        statsDelta.learnedCount = 1;
      } else if (prev.learned && !knowledge.learned) {
        statsDelta.learnedCount = -1;
      }

      // 掌握状态变化
      if (prev.status !== 'mastered' && knowledge.status === 'mastered') {
        statsDelta.masteredCount = 1;
        statsDelta.unmasteredCount = -1;
      } else if (prev.status === 'mastered' && knowledge.status !== 'mastered') {
        statsDelta.masteredCount = -1;
        statsDelta.unmasteredCount = 1;
      }
    } else if (knowledge.learned) {
      // 新增已学习项
      statsDelta.learnedCount = 1;
      if (knowledge.status !== 'mastered') {
        statsDelta.unmasteredCount = 1;
      }
    }

    // 更新统计
    if (Object.keys(statsDelta).length > 0) {
      updateGroupStats(knowledge.groupId, statsDelta);
    }

    // 保存知识点
    const key = `knowledge-${knowledge.id}`;
    wx.setStorageSync(key, knowledge);
    clearCache('knowledge', knowledge.id);
    clearCache('group', knowledge.groupId);
  }

  function removeKnowledge(groupId, knowledgeId) {
    // 获取被删除知识点状态（用于更新统计）
    const knowledge = getKnowledgeById(knowledgeId);

    // 1. 从知识点详情中删除
    wx.removeStorageSync(`knowledge-${knowledgeId}`);
    // 缓存同步：清除知识点缓存、分组缓存
    clearCache && clearCache('knowledge', knowledgeId);
    clearCache && clearCache('group', groupId);

    // 2. 从分组索引中删除
    const groupKey = `group-${groupId}`;
    let knowledgeIds = wx.getStorageSync(groupKey) || [];
    knowledgeIds = knowledgeIds.filter(id => id !== knowledgeId);
    wx.setStorageSync(groupKey, knowledgeIds);

    // 3. 更新分组列表中的知识点数量
    let groups = getAllGroups();
    const groupIndex = groups.findIndex(g => g.id == groupId);
    if (groupIndex > -1) {
      groups[groupIndex].knowledgeCount = knowledgeIds.length;
      wx.setStorageSync('groups', groups);
      if (typeof getApp === 'function') getApp().globalData.groups = groups;
    }

    // 4. 更新统计缓存
    if (knowledge) {
      if (knowledge.learned) {
        incrementGroupStat(groupId, 'learnedCount', -1);
        if (knowledge.status === 'mastered') {
          incrementGroupStat(groupId, 'masteredCount', -1);
        } else {
          incrementGroupStat(groupId, 'unmasteredCount', -1);
        }
      }
    }

    // 5. 更新全局缓存
    // 6. 异步更新分组统计
    setTimeout(() => updateGroupStats(groupId), 100);
  }

  function getKnowledgeById(id) {
    if (typeof id === 'undefined') return null;
    return wx.getStorageSync(`knowledge-${id}`) || null;
  }

  // 获取当天日期字符串
  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // 获取/生成今日复习批次（最多20条），只推送到期（now >= nextReviewTime）的知识点
  function getTodayReviewList(groupId) {
    const key = `todayReviewList-${groupId}`;
    const cache = wx.getStorageSync(key);
    if (cache && cache.date === getTodayStr() && Array.isArray(cache.ids)) {
      return cache.ids.map(id => getKnowledgeById(id)).filter(Boolean);
    }
    return [];
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
    let cache = wx.getStorageSync(key);
    if (!cache || cache.date !== today) {
      wx.removeStorageSync(key);
    }
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

  function getUnlearnedKnowledge(groupId) {
    const batchSize = getSettings().batchSize || 20;
    return getUnlearnedPaged(groupId, 1, batchSize);
  }

  function getUnlearnedBatch(groupId, batchSize) {
    const size = batchSize || getSettings().batchSize || 20;
    return getUnlearnedPaged(groupId, 1, size);
  }

  // 同步刷新（保持兼容）
  function refreshAllReviewLists() {
    const allGroups = getAllGroups();
    const settings = getSettings();
    allGroups.forEach(g => {
      resetTodayReviewListIfNeeded(g.id);
      const allKnowledge = getGroupData(g.id) || [];
      const now = Date.now();
      // 只选到期的，不再凑数，并且获取所有到期内容
      const dueArr = allKnowledge.filter(k => k.learned === true && k.status !== 'mastered' && k.nextReviewTime <= now);
      const ids = dueArr.map(k => k.id);
      wx.setStorageSync(`todayReviewList-${g.id}`, { date: getTodayStr(), ids });
      updateGroupStats(g.id);
    });
  }

  // 新增：异步刷新
  async function refreshAllReviewListsAsync() {
    const allGroups = getAllGroups();
    const settings = getSettings();
    const batchSize = settings.batchSize || 20;

    // 并行处理所有分组
    await Promise.all(allGroups.map(async (g) => {
      resetTodayReviewListIfNeeded(g.id);
      try {
        const allKnowledge = await getGroupDataAsync(g.id);
        const now = Date.now();
        const dueArr = allKnowledge.filter(k => k.learned === true && k.status !== 'mastered' && k.nextReviewTime <= now);
        let batch = dueArr.slice(0, batchSize);
        // const ids = batch.map(k => k.id);
        const ids = dueArr.map(k => k.id);

        // 异步存储
        await new Promise(resolve => {
          wx.setStorage({
            key: `todayReviewList-${g.id}`,
            data: { date: getTodayStr(), ids },
            success: () => resolve(),
            fail: resolve
          });
        });

        updateGroupStats(g.id);
      } catch (e) {
        console.error(`刷新分组 ${g.id} 失败`, e);
      }
    }));
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
    let knowledgeIds = wx.getStorageSync(groupKey) || [];
    let nextId = wx.getStorageSync('nextKnowledgeId') || 1;

    const newIds = [];
    // 分块处理避免UI阻塞
    await processInChunks(knowledgeBatch, async (knowledge) => {
      const newKnowledgeId = nextId;
      knowledge.id = newKnowledgeId;
      knowledge.media = knowledge.media || [];
      knowledge.addTime = knowledge.addTime || Date.now();
      // 保持未学会知识点无 nextReviewTime，仅 learned=true 时由 markLearned 逻辑赋值
      knowledge.learned = typeof knowledge.learned === 'boolean' ? knowledge.learned : false;
      wx.setStorageSync(`knowledge-${newKnowledgeId}`, knowledge);
      newIds.push(newKnowledgeId);
      nextId++;
    });

    wx.setStorageSync('nextKnowledgeId', nextId);

    const updatedIds = knowledgeIds.concat(newIds);
    wx.setStorageSync(groupKey, updatedIds);

    let groups = getAllGroups();
    const groupIndex = groups.findIndex(g => g.id == groupId);
    if (groupIndex !== -1) {
      groups[groupIndex].knowledgeCount = updatedIds.length;
      wx.setStorageSync('groups', groups);
      if (typeof getApp === 'function') getApp().globalData.groups = groups;
    }

    // 更新分组统计
    updateGroupStats(groupId);
    // 缓存同步：清除分组缓存
    clearCache && clearCache('group', groupId);
    return {
      newIds,
      finalKnowledgeCount: updatedIds.length
    };
  }

  // 分块处理函数
  async function processInChunks(items, processFn, chunkSize = 50) {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await Promise.all(chunk.map(processFn));
    }
  }


  function getKnowledgeByIdCached(id) {
    const cached = knowledgeCache.get(id);
    if (cached) {
      perfMetrics.knowledgeCacheHits++;
      return cached;
    }

    perfMetrics.knowledgeCacheMisses++;
    const data = getKnowledgeById(id);
    if (data) knowledgeCache.set(id, data);
    return data;
  }

  function clearCache(type, id) {
    if (type === 'group' && id) groupCache.delete(id);
    if (type === 'knowledge' && id) knowledgeCache.delete(id);
    if (type === 'all') {
      groupCache.clear();
      knowledgeCache.clear();
    }
  }

  // --- 分页数据获取 ---
  function getGroupDataPaged(groupId, page = 1, pageSize = 50) {
    const all = getGroupDataCached(groupId) || [];
    const start = (page - 1) * pageSize;
    return all.slice(start, start + pageSize);
  }

  function getUnlearnedPaged(groupId, page = 1, pageSize = 50) {
    const all = getGroupDataCached(groupId) || [];
    const unlearned = all.filter(k => !k.learned);
    const start = (page - 1) * pageSize;
    return unlearned.slice(start, start + pageSize);
  }

  function getUnlearnedCount(groupId) {
    const all = getGroupDataCached(groupId) || [];
    return all.filter(k => !k.learned).length;
  }
  function getMasteredCount(groupId) {
    const all = getGroupDataCached(groupId) || [];
    return all.filter(k => k.mastered).length;
  }

  // 获取今日待复习数量
  function getDueCount(groupId) {
    return getTodayReviewList(groupId).filter(k => k && k.nextReviewTime <= Date.now()).length;
  }

  function reportPerf() {
    perfMetrics.report();
  }

  return {
    getAllGroups,
    addGroup,
    updateGroup,
    removeGroup,
    getGroupData,
    getGroupDataAsync,
    saveKnowledge,
    removeKnowledge,
    getKnowledgeById,
    addKnowledgeBatchToGroup,
    getTodayReviewList,
    resetTodayReviewListIfNeeded,
    updateKnowledgeBySM2,
    getUnlearnedKnowledge,
    getDefaultSettings,
    getSettings,
    saveSettings,
    refreshAllReviewLists,
    refreshAllReviewListsAsync,
    getUnlearnedBatch,
    getGroupDataCached,
    getKnowledgeByIdCached,
    clearCache,
    getGroupDataPaged,
    getUnlearnedPaged,
    getUnlearnedCount,
    getMasteredCount,
    updateGroupStats,
    // 新增公共方法
    calcGroupStats,
    refreshAllGroupStats,
    getKnowledgeListByIds,
    // 暴露给测试的内部方法
    _getNextId: getNextId,
    _updateKnowledgeBySM2: updateKnowledgeBySM2,
    _getGroupDataDirect: (groupId) => wx.getStorageSync(`group-${groupId}`) || [],
    getDueCount,
    reportPerf
  };
})();

module.exports = GroupManager;
