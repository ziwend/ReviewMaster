// pages/groups/groups.js
const storage = require('../../utils/storage.js');

// 分组知识点数量内存缓存
// let groupKnowledgeCountMap = {}; // 已废弃，无需手动缓存

Page({
  data: {
    groups: [],
    newGroupName: '',
  },

  onLoad: function () {
    this.loadGroups();
    console.log("group on load");    
  },

  onShow: async function () {
    // 先加载缓存数据，提供即时响应
    this.loadGroups();
    
    // 异步刷新复习列表，避免阻塞UI
    storage.refreshAllReviewListsAsync().then(() => {
      // 获取当前组数据
      const currentGroups = this.data.groups.map(g => g.id);
      // 获取最新组数据
      const latestGroups = storage.getAllGroups();
      
      // 检查数据是否有变化
      const hasChanges = latestGroups.some((g, i) => {
        const oldGroup = this.data.groups.find(og => og.id === g.id);
        return !oldGroup || 
               oldGroup.dueCount !== g.dueCount || 
               oldGroup.knowledgeCount !== g.knowledgeCount;
      });
      
      // 只有在数据有变化时才更新UI
      if (hasChanges) {
        this.loadGroups();
      }
    });
    console.log("on show group finished");
  },

  loadGroups: function () {
    // 只加载分组基本信息和统计字段
    const groups = storage.getAllGroups();
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
    const group = storage.getAllGroups().find(g => g.id == id);
    console.log("group click name,id", group.name, id);
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