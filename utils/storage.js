// utils/storage.js
// 本地存储与数据结构管理 (采用索引-数据分离模型)

/**
 * Key-Value Structure:
 * 
 * 'groups': Array<Object> - [{id: 1, name: 'Group Name', knowledge极Count: 10}]
 * 'nextGroupId': Number - e.g., 2
 * 'nextKnowledgeId': Number - e.g., 101
 * 
 * `group-${groupId}`: Array<Number> - [1, 2, 5, 10, ...] (list of knowledge IDs)
 * `knowledge-${knowledgeId}`: Object - {
 *   id: Number,           
 *   question: String,     
 *   answer: String,       
 *   media: Array,         // 媒体资源 [{type: 'image'|'audio', url: String}]
 *   groupId: Number,      
 *   addTime: Number,      
 *   nextReviewTime: Number,
 *   reviewCount: Number,  
 *   history: Array,       
 *   status: String,       
 *   memoryStrength: Number,
 *   difficulty: Number,   
 *   lastInterval: Number  
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
async function process极Chunks(items, processFn, chunkSize = 50) {
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
  return wx.getStorageSync('groups') || [];
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
  }
}

function removeGroup(groupId) {
  // 1. 从分组列表中移除
  let groups = getAllGroups();
  const updatedGroups = groups.filter(g => g.id !== groupId);
  wx.setStorageSync('groups', updatedGroups);

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
  // 使用分块处理避免UI阻塞
  await processInChunks(knowledgeBatch, async (knowledge) => {
    const newKnowledgeId = nextId;
    knowledge.id = newKnowledgeId;
    
    // 初始化所有字段
    knowledge.media = knowledge.media || []; 
    knowledge.memoryStrength = knowledge.memoryStrength || 0;
    knowledge.difficulty = knowledge.difficulty || 3;
    knowledge.lastInterval = knowledge.lastInterval || 0;
    knowledge.status = knowledge.status || 'pending';
    knowledge.reviewCount = knowledge.reviewCount || 0;
    knowledge.history = knowledge.history || [];
    knowledge.addTime = knowledge.addTime || Date.now();
    knowledge.nextReviewTime = knowledge.nextReviewTime || Date.now();
    
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
  }

  // 更新缓存
  updateGroupCountCache(groupId, knowledgeBatch.length);

  return { 
    newIds, 
    finalKnowledgeCount: updatedIds.length
  };
}

function saveKnowledge(knowledge) {
  if (!knowledge || typeof knowledge.id === 'undefined') {
    console.error('saveKnowledge failed: knowledge or knowledge.id is missing', knowledge);
    return;
  }
  const key = `knowledge-${knowledge.id}`;
  wx.setStorageSync(key, knowledge);
}

function removeKnowledge(groupId, knowledgeId) {
  // 1. 从知识点详情中删除
  wx.removeStorageSync(`knowledge-${knowledgeId}`);

  // 2. 从分组索引中删除
  const groupKey = `group-${groupId}`;
  let knowledgeIds = wx.getStorageSync(group极Key) || [];
  knowledgeIds = knowledgeIds.filter(id => id !== knowledgeId);
  wx.setStorageSync(groupKey, knowledgeIds);

  // 3. 更新分组列表中的知识点数量
  let groups = getAllGroups();
  const groupIndex = groups.findIndex(g => g.id == groupId);
  if (groupIndex > -1) {
    groups[groupIndex].knowledgeCount = knowledgeIds.length;
    wx.setStorageSync('groups', groups);
  }

  // 更新缓存
  updateGroupCountCache(groupId, -1);
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
    // 今日已生成，动态过滤：只保留当前依然 due 且未掌握的题
    const now = Date.now();
    return cache.ids
      .map(id => getKnowledgeById(id))
      .filter(k => k && k.status !== 'mastered' && k.nextReviewTime <= now);
  }
  // 生成今日批次
  const all = getGroupData(groupId) || [];
  const now = Date.now();
  // 1. 先选due的
  const due = all.filter(k => k.nextReviewTime <= now && k.status !== 'mastered');
  // 2. 不足补未复习的
  let batch = due.slice(0, batchSize);
  if (batch.length < batchSize) {
    const notReviewed = all.filter(k => (!k.history || k.history.length === 0) && !batch.includes(k));
    batch = batch.concat(notReviewed.slice(0, batchSize - batch.length));
  }
  // 只取id
  const ids = batch.map(k => k.id);
  wx.setStorageSync(key, { date: today, ids });
  return batch;
}

// 日期变更时重置今日批次
function resetTodayReviewListIfNeeded(groupId) {
  const key = `todayReviewList-${groupId}`;
  const today = getTodayStr();
  let cache = wx.getStorageSync(key);
  if (!cache || cache.date !== today) {
    wx.removeStorageSync(key);
  }
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
  resetTodayReviewListIfNeeded,
};
