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
    this.loadGroups();
  },

  loadGroups: function () {
    this.setData({ loading: true });
    // 优先用缓存
    const groups = storage.getAllGroups().map(g => ({
      id: g.id,
      name: g.name,
      knowledgeCount: g.knowledgeCount,
      dueCount: 0 // 初始化
    }));
    this.setData({
      groups,
      newGroupName: '',
      loading: false
    }, () => {
      this.updateGroupStats();
    });
  },

  updateGroupStats: function () {
    this.data.groups.forEach((group, index) => {
      // 每次都刷新今日批次
      storage.resetTodayReviewListIfNeeded(group.id);
      const todayList = storage.getTodayReviewList(group.id);
      this.setData({
        [`groups[${index}].dueCount`]: todayList.length
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
    this.loadGroups();
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
    console.log("group to review选择groupId=", id);
    wx.navigateTo({
      url: `/pages/review/review?groupId=${id}`
    });
  }
  // ... rest of the existing code ...
});