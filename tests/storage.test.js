const assert = require('assert');
// 1. 清理所有相关 require 缓存（不仅仅是 storage.js）
console.log('--- BEFORE require.cache keys ---', Object.keys(require.cache));
for (const k of Object.keys(require.cache)) {
  if (k.includes('storage') || k.includes('lru')) {
    delete require.cache[k];
  }
}
console.log('--- AFTER require.cache keys ---', Object.keys(require.cache));
// 2. 彻底销毁全局变量
if (typeof global !== 'undefined') {
  delete global.__MOCK_STORAGE__;
}
// 3. 重建全局变量为标准对象
if (typeof global !== 'undefined') {
  global.__MOCK_STORAGE__ = {};
  console.log('global.__MOCK_STORAGE__ proto:', Object.getPrototypeOf(global.__MOCK_STORAGE__));
}
// 4. 现在再 require storage
const storage = require('../utils/storage');
console.log('storage._mockStorage proto:', Object.getPrototypeOf(storage._mockStorage));

// 模拟 getApp，保证全局变量隔离
if (!global.getApp) {
  global.getApp = () => ({
    globalData: {
      groups: [],
      settings: {},
      groupStats: {},
      groupKnowledgeCountMap: {}
    }
  });
}

describe('存储模块测试', () => {
  // 只在suite开始时清空一次，保证分组数据持久化
  before(function() {
    if (typeof global !== 'undefined') {
      global.__MOCK_STORAGE__ = {};
    }
    for (const k in storage._mockStorage) delete storage._mockStorage[k];
    storage._mockStorage['nextGroupId'] = 1;
    storage._mockStorage['nextKnowledgeId'] = 1;
    storage._mockStorage['groups'] = [];
    if (global.getApp) {
      const app = global.getApp();
      app.globalData.groups = [];
    }
    storage.clearCache('all');
    if (storage.perfMetrics) {
      for (const k in storage.perfMetrics) {
        if (typeof storage.perfMetrics[k] === 'number') storage.perfMetrics[k] = 0;
      }
    }
    // 调试：打印 mockStorage 原型
    console.log('[before] mockStorage proto:', Object.getPrototypeOf(storage._mockStorage));
    console.log('[before] groups proto:', Object.getPrototypeOf(storage._mockStorage.groups));
    console.log('[before] groups:', JSON.stringify(storage._mockStorage.groups, null, 2));
  });

  beforeEach(() => {
    // 不再清空mockStorage['groups']和id生成器，只重置缓存和全局变量
    if (global.getApp) {
      const app = global.getApp();
      app.globalData.groups = [];
    }
    storage.clearCache('all');
    if (storage.perfMetrics) {
      for (const k in storage.perfMetrics) {
        if (typeof storage.perfMetrics[k] === 'number') storage.perfMetrics[k] = 0;
      }
    }
    // 调试：打印 mockStorage 原型
    console.log('[beforeEach] mockStorage proto:', Object.getPrototypeOf(storage._mockStorage));
    console.log('[beforeEach] groups proto:', Object.getPrototypeOf(storage._mockStorage.groups));
    console.log('[beforeEach] groups:', JSON.stringify(storage._mockStorage.groups, null, 2));
  });

  afterEach(() => {
    // 调试：打印 mockStorage 原型
    console.log('[afterEach] mockStorage proto:', Object.getPrototypeOf(storage._mockStorage));
    console.log('[afterEach] groups proto:', Object.getPrototypeOf(storage._mockStorage.groups));
    console.log('[afterEach] groups:', JSON.stringify(storage._mockStorage.groups, null, 2));
  });

  it('应正确生成下一个ID', () => {
    storage._mockStorage['nextGroupId'] = 5;
    const nextId = storage._getNextId('nextGroupId');
    assert.strictEqual(nextId, 5);
    assert.strictEqual(storage._mockStorage['nextGroupId'], 6);
  });

  it('应成功添加新分组', () => {
    const newGroup = storage.addGroup('测试分组');
    assert.strictEqual(newGroup.name, '测试分组');
    assert.strictEqual(newGroup.knowledgeCount, 0);
    assert.strictEqual(storage.getAllGroups().length, 1);
  });

  it('应正确保存知识点', () => {
    const group = storage.addGroup('保存分组');
    const id = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({
      id: String(id),
      groupId: String(group.id),
      question: '测试问题',
      answer: '测试答案',
      learned: false
    });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      storage.perfSetStorageSync('group-' + String(group.id), ids);
    }
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    const saved = storage.perfGetStorageSync('knowledge-' + String(id));
    assert.strictEqual(saved.question, '测试问题');
  });


  it('知识点从mastered恢复为pending时，masteredCount应减少', async function() {
    const group = storage.addGroup('分组');
    const id = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({ id: String(id), groupId: String(group.id), learned: true, status: 'mastered' });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      storage.perfSetStorageSync('group-' + String(group.id), ids);
    }
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    storage._mockStorage['group-' + String(group.id)] = storage.perfGetStorageSync('group-' + String(group.id));
    await storage.refreshAllGroupStats();
    storage._mockStorage['groups'] = storage.perfGetStorageSync('groups');
    const g1 = storage._mockStorage['groups'].find(g => String(g.id) === String(group.id));
    assert.strictEqual(g1.masteredCount, 1, 'masteredCount 应为1');
    // 恢复为 pending
    storage.saveKnowledge({ id: String(id), groupId: String(group.id), learned: true, status: 'pending' });
    storage.clearCache('all');
    storage._mockStorage['group-' + String(group.id)] = storage.perfGetStorageSync('group-' + String(group.id));
    await storage.refreshAllGroupStats();
    storage._mockStorage['groups'] = storage.perfGetStorageSync('groups');
    const g2 = storage._mockStorage['groups'].find(g => String(g.id) === String(group.id));
    assert.strictEqual(g2.masteredCount, 0, 'masteredCount 应为0');
  });

  it('应正确处理缓存', () => {
    const group = storage.addGroup('缓存分组');
    const id = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({ id: String(id), groupId: String(group.id), learned: false });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      storage.perfSetStorageSync('group-' + String(group.id), ids);
    }
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    storage.getGroupDataCached(String(group.id)); // miss
    storage.getGroupDataCached(String(group.id)); // hit
    assert.strictEqual(storage.perfMetrics.groupCacheHits, 1);
  });

  it('应正确统计缓存命中率', () => {
    const group = storage.addGroup('命中率分组');
    const id = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({ id: String(id), groupId: String(group.id), learned: false });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      storage.perfSetStorageSync('group-' + String(group.id), ids);
    }
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    storage.getGroupDataCached(String(group.id)); // miss
    storage.getGroupDataCached(String(group.id)); // hit
    assert.strictEqual(storage.perfMetrics.groupCacheHits, 1);
    assert.strictEqual(storage.perfMetrics.groupCacheMisses, 1);
    assert.strictEqual(storage.perfMetrics.getGroupCacheHitRate(), '0.50');
  });

  it('分页查询应正确工作', async () => {
    const group = storage.addGroup('分页分组');
    const id1 = storage._getNextId('nextKnowledgeId');
    const id2 = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({ id: String(id1), groupId: String(group.id), learned: false });
    storage.saveKnowledge({ id: String(id2), groupId: String(group.id), learned: false });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id1))) ids.push(String(id1));
    if (!ids.includes(String(id2))) ids.push(String(id2));
    storage.perfSetStorageSync('group-' + String(group.id), ids);
    // 立即清理分组缓存，防止缓存污染
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    await storage.refreshAllGroupStats();
    storage._mockStorage['groups'] = storage.perfGetStorageSync('groups');
    const page1 = storage.getUnlearnedPaged(String(group.id), 1, 2);

    assert.strictEqual(page1.length, 2, '未学习知识点分页查询失败');
  });

  it('批量添加知识点应正确工作', async () => {
    const group = storage.addGroup('批量分组');
    const batch = [
      { question: 'Q1', answer: 'A1', learned: false },
      { question: 'Q2', answer: 'A2', learned: false }
    ];
    const result = await storage.addKnowledgeBatchToGroup(String(group.id), batch);
    await storage.refreshAllGroupStats();
    storage._mockStorage['groups'] = storage.perfGetStorageSync('groups');
    const g = storage._mockStorage['groups'].find(g => String(g.id) === String(group.id));
    assert.strictEqual(result.finalKnowledgeCount, 2);
    assert.strictEqual(g.knowledgeCount, 2);
  });

  it('分组统计更新应正确计算', async function() {
    const group = storage.addGroup('分组');
    const id = storage._getNextId('nextKnowledgeId');
    storage.saveKnowledge({ id: String(id), groupId: String(group.id), learned: true, status: 'learned' });
    // 补分组索引
    let ids = storage.perfGetStorageSync('group-' + String(group.id)) || [];
    if (!ids.includes(String(id))) {
      ids.push(String(id));
      storage.perfSetStorageSync('group-' + String(group.id), ids);
    }
    // 立即清理分组缓存，防止缓存污染
    storage.clearCache('group', String(group.id));
    storage.clearCache('all');
    storage._mockStorage['group-' + String(group.id)] = storage.perfGetStorageSync('group-' + String(group.id));
    await storage.refreshAllGroupStats();
    storage._mockStorage['groups'] = storage.perfGetStorageSync('groups');
    const g1 = storage._mockStorage['groups'].find(g => String(g.id) === String(group.id));
    assert.strictEqual(g1.learnedCount, 1, 'learnedCount 应为1');
  });

});
