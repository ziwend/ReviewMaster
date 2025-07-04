// pages/groups/groups.js
const storage = require('../../utils/storage.js');

// 分组知识点数量内存缓存
// let groupKnowledgeCountMap = {}; // 已废弃，无需手动缓存

Page({
  data: {
    groups: [],
    newGroupName: '',
    loading: true
  },

  onLoad: function () {
    // this.loadGroups();
  },

  onShow: function () {
    this.loadGroups();
  },

  loadGroups: function () {
    // 只加载分组基本信息和统计字段
    const groups = getApp().globalData.groups.map(g => ({
      id: g.id,
      name: g.name,
      knowledgeCount: g.knowledgeCount,
      unmasteredCount: g.unmasteredCount || 0,
      learnedCount: g.learnedCount || 0
    }));
    this.setData({
      groups,
      newGroupName: '',
      loading: false
    }, () => {
      // dueCount可能有变
      this.updateGroupStats();
    });
  },

  updateGroupStats: function () {
    storage.refreshAllReviewLists();

    // 只更新dueCount字段
    const dueCountMap = {};
    getApp().globalData.groups.forEach(g => {
      dueCountMap[g.id] = g.dueCount || 0;
    });

    // 更新this.data.groups中的dueCount
    const groups = this.data.groups.map(g => ({
      ...g,
      dueCount: dueCountMap[g.id] || 0
    }));

    this.setData({ groups });
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
    try {
      const newGroup = storage.addGroup(this.data.newGroupName);

      wx.navigateTo({
        url: `/pages/import/import?groupId=${newGroup.id}`
      });
    } catch (e) {
      wx.showToast({ title: '存储空间不足，请清理部分分组或知识点', icon: 'none' });
      console.error('addGroup writeFile err', e);
    }
  },

  removeGroup: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除确认',
      content: `确定要删除分组 "${name}" 及其所有知识点吗？此操作不可撤销。`,
      success: (res) => {
        if (res.confirm) {
          try {
            storage.removeGroup(id);
            this.loadGroups();
          } catch (e) {
            wx.showToast({ title: '存储空间不足，请清理部分分组或知识点', icon: 'none' });
            console.error('removeGroup writeFile err', e);
          }
        }
      }
    });
  },

  toReviewPage: function (e) {
    const { id } = e.currentTarget.dataset;
    const group = getApp().globalData.groups.find(g => g.id == id);
    if (group && group.knowledgeCount === 0) {
      wx.navigateTo({
        url: `/pages/import/import?groupId=${id}`
      });
    } else if (group && group.dueCount === 0 && group.learnedCount < group.knowledgeCount) {
      wx.navigateTo({
        url: `/pages/learn/learn?groupId=${id}`
      });
    } else if (group && group.dueCount === 0 && group.learnedCount > group.unmasteredCount) {
      wx.navigateTo({
        url: `/pages/mastered/mastered?groupId=${id}`
      });
    } else if (group && group.dueCount > 0) {
        wx.navigateTo({
            url: `/pages/review/review?groupId=${id}`
        });
    } else {
        wx.showToast({ title: '没有待复习，待学习，已掌握的知识点', icon: 'none' });
    }
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