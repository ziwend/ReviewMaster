const assert = require('assert');
const storage = require('../utils/storage');

// 模拟wx.storage方法
const mockStorage = {};
const wx = {
  getStorageSync: (key) => mockStorage[key],
  setStorageSync: (key, value) => { mockStorage[key] = value; },
  removeStorageSync: (key) => { delete mockStorage[key]; },
  getStorage: (options) => {
    setTimeout(() => {
      options.success({ data: mockStorage[options.key] });
    }, 10);
  }
};
global.wx = wx;

// 模拟getApp
global.getApp = () => ({
  globalData: {
    groups: [],
    groupStats: {},
    groupKnowledgeCountMap: {}
  },
  refreshGroups: function() {
    this.globalData.groups = mockStorage['groups'] || [];
  }
});

describe('存储模块测试', () => {
  beforeEach(() => {
    // 清空模拟存储
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    // 重置全局数据
    getApp().globalData = {
      groups: [],
      groupStats: {},
      groupKnowledgeCountMap: {}
    };
  });

  it('应正确生成下一个ID', () => {
    mockStorage['nextGroupId'] = 5;
    const nextId = storage._getNextId('nextGroupId');
    assert.strictEqual(nextId, 5);
    assert.strictEqual(mockStorage['nextGroupId'], 6);
  });

  it('应成功添加新分组', () => {
    const newGroup = storage.addGroup('测试分组');
    assert.strictEqual(newGroup.name, '测试分组');
    assert.strictEqual(newGroup.knowledgeCount, 0);
    assert.strictEqual(mockStorage['groups'].length, 1);
  });

  it('应正确保存知识点', () => {
    const knowledge = {
      id: 1,
      groupId: 1,
      question: '测试问题',
      answer: '测试答案',
      learned: false
    };
    
    storage.saveKnowledge(knowledge);
    const saved = mockStorage['knowledge-1'];
    assert.strictEqual(saved.question, '测试问题');
  });

  it('应使用SM2算法更新知识点', () => {
    const knowledge = {
      id: 1,
      groupId: 1,
      efactor: 2.5,
      interval: 0,
      repetition: 0
    };
    
    // 测试记住的情况（质量5）
    const updated = storage._updateKnowledgeBySM2(knowledge, 5);
    assert.strictEqual(updated.repetition, 1);
    assert.strictEqual(updated.interval > 0, true);
    assert.strictEqual(updated.efactor > 2.5, true);
    
    // 测试忘记的情况（质量0）
    const forgotten = storage._updateKnowledgeBySM2(knowledge, 0);
    assert.strictEqual(forgotten.repetition, 0);
    assert.strictEqual(forgotten.status, 'pending');
  });

  it('应正确处理缓存', () => {
    // 添加测试数据
    mockStorage['group-1'] = [{id: 1, name: '测试知识点'}];
    
    // 第一次获取（应缓存）
    const data1 = storage.getGroupDataCached(1);
    assert.strictEqual(data1.length, 1);
    
    // 修改原始数据
    mockStorage['group-1'] = [];
    
    // 第二次获取（应返回缓存）
    const data2 = storage.getGroupDataCached(1);
    assert.strictEqual(data2.length, 1);
    
    // 清除缓存后获取
    storage.clearCache('group', 1);
    const data3 = storage._getGroupDataDirect(1);
    assert.strictEqual(data3.length, 0);
  });
});

console.log('测试文件创建完成。请安装测试运行器并执行测试。');
