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
 * `knowledge-${knowledgeId}`: Object - {id, question, answer, addTime, ...}
 */

// --- Helper Functions ---

function getNextId(key) {
  let nextId = wx.getStorageSync(key) || 1;
  wx.setStorageSync(key, nextId + 1);
  return nextId;
}

// --- Group Functions ---

function getAllGroups() {
  return wx.getStorageSync('groups') || [];
}

function addGroup(groupName) {
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
const groupKnowledgeCountMap = (typeof getApp === 'function' && getApp().globalData) ? getApp().globalData.groupKnowledgeCountMap : {};

function addKnowledgeBatchToGroup(groupId, knowledgeBatch) {
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
  knowledgeBatch.forEach(knowledge => {
    const newKnowledgeId = nextId;
    knowledge.id = newKnowledgeId;
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
  if (groupKnowledgeCountMap) {
    groupKnowledgeCountMap[groupId] = (groupKnowledgeCountMap[groupId] || 0) + knowledgeBatch.length;
  }

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
  let knowledgeIds = wx.getStorageSync(groupKey) || [];
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
  if (groupKnowledgeCountMap) {
    groupKnowledgeCountMap[groupId] = Math.max(0, (groupKnowledgeCountMap[groupId] || 1) - 1);
  }
}

function getKnowledgeById(id) {
  if (typeof id === 'undefined') return null;
  return wx.getStorageSync(`knowledge-${id}`) || null;
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
};