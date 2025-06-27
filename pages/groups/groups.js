// pages/groups/groups.js
const storage = require('../../utils/storage.js');

// 分组知识点数量内存缓存
let groupKnowledgeCountMap = {};

Page({
  data: {
    groups: [],
    newGroupName: '',
    loading: true
  },

  onLoad: function () {
    this.loadGroups();
  },

  onShow: function () {
    storage.refreshAllReviewLists();
    this.loadGroups();
  },

  loadGroups: function () {
    this.setData({ loading: true });
    // 只加载分组基本信息和统计字段
    const groups = getApp().globalData.groups.map(g => ({
      id: g.id,
      name: g.name,
      knowledgeCount: g.knowledgeCount,
      dueCount: g.dueCount || 0,
      unmasteredCount: g.unmasteredCount || 0,
      learnedCount: g.learnedCount || 0
    }));
    this.setData({
      groups,
      newGroupName: '',
      loading: false
    });
  },

  updateGroupStats: function () {
    this.data.groups.forEach((group, index) => {
      // 只读缓存，不再刷新今日批次
      const todayList = storage.getTodayReviewList(group.id);
      // 统计已学会/未掌握数量（未掌握基于已学会）
      const allKnowledge = storage.getGroupData(group.id) || [];
      const learnedList = allKnowledge.filter(k => k.learned === true);
      const learnedCount = learnedList.length;
      const unmasteredCount = learnedList.filter(k => k.status !== 'mastered').length;
      this.setData({
        [`groups[${index}].dueCount`]: todayList.length,
        [`groups[${index}].unmasteredCount`]: unmasteredCount,
        [`groups[${index}].learnedCount`]: learnedCount
      });
    });
  },

  handleGroupNameInput: function(e) {
    this.setData({
      newGroupName: e.detail.value
    });
  },

  addGroup: function() {
    if (!this.data.newGroupName.trim()) {
      wx.showToast({
        title: '分组名不能为空',
        icon: 'none'
      });
      return;
    }
    const newGroup = storage.addGroup(this.data.newGroupName);
    groupKnowledgeCountMap[newGroup.id] = 0; // 新增分组，缓存初始化为0
    // this.loadGroups();
    wx.navigateTo({
      url: `/pages/import/import?groupId=${newGroup.id}`
    });
  },

  removeGroup: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除确认',
      content: `确定要删除分组 "${name}" 及其所有知识点吗？此操作不可撤销。`,
      success: (res) => {
        if (res.confirm) {
          storage.removeGroup(id);
          delete groupKnowledgeCountMap[id]; // 删除缓存
          this.loadGroups();
        }
      }
    });
  },

  toReviewPage: function (e) {
    const { id } = e.currentTarget.dataset;

    wx.navigateTo({
      url: `/pages/review/review?groupId=${id}`
    });
  },

  onRenameConfirm() {
    // ...
  },

  toSettings() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    });
  }
});