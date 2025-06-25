// utils/storage.js
// 本地存储与数据结构管理 (采用索引-数据分离模型)

/**
 * Key-Value Structure:
 * 
 * 'groups': Array<Object> - [{id: 1, name: 'Group Name', knowledgeCount: 10}]
 * 'nextGroupId': Number - e.g., 2
 * 'nextKnowledgeId': Number - e.g., 101
 * 
 * `group-${groupId}`: Array<Number> - [1, 2, 5, 10, ...] (list of knowledge IDs)
 * `knowledge-${knowledgeId}`: Object - {
 *   id: Number,           // 唯一ID
 *   question: String,     // 问题
 *   answer: String,       // 答案
 *   media: Array,         // 媒体资源 [{type: 'image'|'audio', url: String}]
 *   groupId: Number,      // 所属分组ID
 *   addTime: Number,      // 添加时间戳
 *   nextReviewTime: Number, // 下次复习时间
 *   reviewCount: Number,  // 总复习次数
 *   history: Array,       // 复习历史 [{time, quality, interval, efactor}]
 *   status: String,       // 状态: pending/reviewing/mastered
 *   repetition: Number,   // 连续记住次数（SM-2算法）
 *   efactor: Number,      // 易记因子（SM-2算法）
 *   learned: Boolean      // 是否已学习
 * }
 */

// --- Helper Functions ---

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

// 分块处理函数
async function processInChunks(items, processFn, chunkSize = 50) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    await Promise.all(chunk.map(processFn));
  }
}

// 解耦全局状态更新
function updateGroupCountCache(groupId, delta) {
  try {
    if (typeof getApp === 'function' && getApp().globalData?.groupKnowledgeCountMap) {
      const map = getApp().globalData.groupKnowledgeCountMap;
      map[groupId] = (map[groupId] || 0) + delta;
    }
  } catch (e) {
    console.error('updateGroupCountCache failed:', e);
  }
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
    if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
    // 为新组创建一个空的知识点索引
    wx.setStorageSync(`group-${newGroup.id}`, []);
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

function updateGroup(groupToUpdate) {
  let groups = getAllGroups();
  const index = groups.findIndex(g => g.id === groupToUpdate.id);
  if (index !== -1) {
    groups[index].name = groupToUpdate.name;
    wx.setStorageSync('groups', groups);
    // 更新全局groups
    if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
  }
}

function removeGroup(groupId) {
  // 1. 从分组列表中移除
  let groups = getAllGroups();
  const updatedGroups = groups.filter(g => g.id !== groupId);
  wx.setStorageSync('groups', updatedGroups);
  // 更新全局groups
  if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
  // 2. 删除该分组下的所有知识点详情
  const groupKey = `group-${groupId}`;
  const knowledgeIds = wx.getStorageSync(groupKey) || [];
  knowledgeIds.forEach(id => {
    wx.removeStorageSync(`knowledge-${id}`);
  });
  // 3. 删除分组索引本身
  wx.removeStorageSync(groupKey);
}

// --- Knowledge Functions ---

function getGroupData(groupId) {
  const groupKey = `group-${groupId}`;
  const knowledgeIds = wx.getStorageSync(groupKey) || [];
  if (!knowledgeIds) {
    return [];
  }
  const knowledgeList = knowledgeIds.map(id => getKnowledgeById(id)).filter(item => item !== null);
  return knowledgeList;
}

// 分组知识点数量内存缓存（全局）
if (typeof getApp === 'function') {
  try {
    if (!getApp().globalData) getApp().globalData = {};
    if (!getApp().globalData.groupKnowledgeCountMap) getApp().globalData.groupKnowledgeCountMap = {};
  } catch (e) {}
}

function updateGroupStats(groupId) {
  const cache = wx.getStorageSync(`todayReviewList-${groupId}`);
  let dueCount = 0;
  if (cache && Array.isArray(cache.ids)) {
    dueCount = cache.ids
      .map(id => getKnowledgeById(id))
      .filter(k => k && k.nextReviewTime <= Date.now())
      .length;
  }
  const allKnowledge = getGroupData(groupId) || [];
  const learnedCount = allKnowledge.filter(k => k.learned === true).length;
  const unmasteredCount = allKnowledge.filter(k => k.learned === true && k.status !== 'mastered').length;
  let groups = getAllGroups();
  const idx = groups.findIndex(g => g.id == groupId);
  if (idx !== -1) {
    groups[idx].dueCount = dueCount;
    groups[idx].learnedCount = learnedCount;
    groups[idx].unmasteredCount = unmasteredCount;
    wx.setStorageSync('groups', groups);
    if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
  }
}

// 在知识点变动时自动更新分组统计
function saveKnowledge(knowledge) {
  if (!knowledge || typeof knowledge.id === 'undefined') {
    console.error('saveKnowledge failed: knowledge or knowledge.id is missing', knowledge);
    return;
  }
  if (typeof knowledge.learned !== 'boolean') knowledge.learned = false;
  const key = `knowledge-${knowledge.id}`;
  wx.setStorageSync(key, knowledge);
  if (knowledge.groupId) updateGroupStats(knowledge.groupId);
}

function removeKnowledge(groupId, knowledgeId) {
  // 1. 从知识点详情中删除
  wx.removeStorageSync(`knowledge-${knowledgeId}`);

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
    if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
  }

  // 更新缓存
  updateGroupCountCache(groupId, -1);

  updateGroupStats(groupId);
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

// 获取/生成今日复习批次（最多20条），优先due，不足补未复习
function getTodayReviewList(groupId, batchSize = 20) {
  const key = `todayReviewList-${groupId}`;
  const today = getTodayStr();
  let cache = wx.getStorageSync(key);
  if (cache && cache.date === today && Array.isArray(cache.ids)) {
    // 命中缓存
    console.log('[getTodayReviewList] 命中缓存:', key, cache);
    return cache.ids
      .map(id => getKnowledgeById(id))
      .filter(k => k && k.status !== 'mastered' && k.nextReviewTime <= Date.now() && k.learned);
  }
  // 生成今日批次
  const all = getGroupData(groupId) || [];
  const now = Date.now();
  if (all.length === 0) {
    // 分组无知识点，不生成缓存
    console.log('[getTodayReviewList] 分组无知识点，不生成缓存:', key);
    return [];
  }
  // 1. 先选due的
  const due = all.filter(k => k.nextReviewTime <= now && k.status !== 'mastered' && k.learned);
  // 2. 不足补未复习的
  let batch = due.slice(0, batchSize);
  if (batch.length < batchSize) {
    const notReviewed = all.filter(k => (!k.history || k.history.length === 0) && !batch.includes(k) && k.learned);
    batch = batch.concat(notReviewed.slice(0, batchSize - batch.length));
  }
  // 只取id
  const ids = batch.map(k => k.id);
  if (ids.length > 0) {
    wx.setStorageSync(key, { date: today, ids });
    console.log('[getTodayReviewList] 生成缓存:', key, { date: today, ids }, '知识点总数:', all.length);
  } else {
    // 不写入空缓存
    console.log('[getTodayReviewList] batch为空，不写入缓存:', key);
  }
  return batch;
}

// 清理历史空缓存
function cleanEmptyTodayReviewListCache(groupId) {
  const key = `todayReviewList-${groupId}`;
  const cache = wx.getStorageSync(key);
  if (cache && Array.isArray(cache.ids) && cache.ids.length === 0) {
    wx.removeStorageSync(key);
    console.log('[cleanEmptyTodayReviewListCache] 清理历史空缓存:', key);
  }
}

// 日期变更时重置今日批次
function resetTodayReviewListIfNeeded(groupId) {
  const key = `todayReviewList-${groupId}`;
  const today = getTodayStr();
  let cache = wx.getStorageSync(key);
  if (!cache || cache.date !== today) {
    wx.removeStorageSync(key);
    console.log('[resetTodayReviewListIfNeeded] 日期变更，重置今日复习缓存:', key);
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
  const all = getGroupData(groupId) || [];
  return all.filter(k => !k.learned);
}

const defaultSettings = {
  batchSize: 20,
  delayRemember: 10, // seconds
  delayForget: 30, // seconds
};

function getDefaultSettings() {
  return JSON.parse(JSON.stringify(defaultSettings));
}

function getSettings() {
  const settings = wx.getStorageSync('app_settings');
  if (settings) {
    // 合并默认设置，防止新增设置项的用户本地没有
    return { ...getDefaultSettings(), ...settings };
  }
  return getDefaultSettings();
}

function saveSettings(settings) {
  wx.setStorageSync('app_settings', settings);
}

function refreshAllReviewLists() {
  const allGroups = getAllGroups();
  const settings = getSettings();
  const batchSize = settings.batchSize || 20;
  allGroups.forEach(g => {
    resetTodayReviewListIfNeeded(g.id);
    // 严格生成reviewList：只包含learned且到期，长度不超过batchSize
    const allKnowledge = getGroupData(g.id) || [];
    const now = Date.now();
    // 先选到期的learned知识点
    const dueArr = allKnowledge.filter(k => k.learned === true && k.status !== 'mastered' && k.nextReviewTime <= now);
    // 不足batchSize再补未复习的learned
    let batch = dueArr.slice(0, batchSize);
    if (batch.length < batchSize) {
      const notReviewed = allKnowledge.filter(k => k.learned === true && (!k.history || k.history.length === 0) && !batch.includes(k));
      batch = batch.concat(notReviewed.slice(0, batchSize - batch.length));
    }
    const ids = batch.map(k => k.id);
    wx.setStorageSync(`todayReviewList-${g.id}`, { date: getTodayStr(), ids });
    // 同步更新分组统计字段
    updateGroupStats(g.id);
  });
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
    knowledge.difficulty = knowledge.difficulty || 3;
    knowledge.addTime = knowledge.addTime || Date.now();
    knowledge.nextReviewTime = knowledge.nextReviewTime || Date.now();
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
    if (typeof getApp === 'function') getApp().refreshGroups && getApp().refreshGroups();
  }

  // 更新分组统计
  updateGroupStats(groupId);

  updateGroupCountCache(groupId, knowledgeBatch.length);

  return { 
    newIds, 
    finalKnowledgeCount: updatedIds.length
  };
}

module.exports = {
  getAllGroups,
  addGroup,
  updateGroup,
  removeGroup,
  getGroupData,
  saveKnowledge,
  removeKnowledge,
  getKnowledgeById,
  addKnowledgeBatchToGroup,
  getTodayReviewList,
  cleanEmptyTodayReviewListCache,
  resetTodayReviewListIfNeeded,
  updateKnowledgeBySM2,
  getUnlearnedKnowledge,
  getDefaultSettings,
  getSettings,
  saveSettings,
  refreshAllReviewLists,
  updateGroupStats,
};
