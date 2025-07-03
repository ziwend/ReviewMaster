const storage = require('../../utils/storage')

Page({
  data: {
    groups: [],
    groupIndex: 0,
    currentGroupId: null,
    masteredList: [],
    isEmpty: false,
  },

  onLoad: async function (options) {
    await this.initData();
  },

  onShow: async function () {
    await this.initData();
  },

  initData: async function() {
    const groups = await storage.getAllGroups() || [];
    const groupIndex = this.data.groupIndex < groups.length ? this.data.groupIndex : 0;
    const currentGroupId = groups.length > 0 ? groups[groupIndex].id : null;
    
    this.setData({
      groups: groups,
      groupIndex: groupIndex,
      currentGroupId: currentGroupId,
    });
    
    if (currentGroupId) {
      await this.loadMasteredList();
    } else {
      this.setData({
        masteredList: [],
        isEmpty: true,
      });
    }
  },

  onGroupChange: async function (e) {
    const groupIndex = e.detail.value;
    this.setData({
      groupIndex: groupIndex,
      currentGroupId: this.data.groups[groupIndex].id,
    });
    await this.loadMasteredList();
  },

  loadMasteredList: async function () {
    if (!this.data.currentGroupId) {
      this.setData({ masteredList: [], isEmpty: true });
      return;
    }
    const allKnowledge = await storage.getGroupData(this.data.currentGroupId) || [];
    const masteredList = allKnowledge.filter(k => k.status === 'mastered');
    
    this.setData({
      masteredList: masteredList,
      isEmpty: masteredList.length === 0,
    });
  },

  restoreKnowledge: async function (e) {
    const { id } = e.currentTarget.dataset;
    const knowledge = this.data.masteredList.find(k => k.id === id);
    if (knowledge) {
      knowledge.status = 'pending';
      knowledge.nextReviewTime = Date.now();
      await storage.updateKnowledge(knowledge);
      
      await this.loadMasteredList();

      wx.showToast({
        title: '已恢复',
        icon: 'success',
      });
    }
  },

  removeKnowledge: async function(e) {
    const id = e.currentTarget.dataset.id
    const { currentGroupId } = this.data;
    if (!currentGroupId) return;

    try {
      await new Promise((resolve, reject) => {
        wx.showModal({
          title: '删除知识点',
          content: '确定要删除该知识点吗？',
          success: res => res.confirm ? resolve() : reject(new Error('用户取消'))
        });
      });
      await storage.removeKnowledge(id, currentGroupId);
      await this.loadMasteredList();
    } catch (error) {
      // 用户取消，不做任何事
    }
  },

  toGroups() {
    wx.navigateTo({ url: '/pages/groups/groups' })
  },

  // 新增：点击知识点显示复习记录
  showHistory(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/history/history?id=${id}`
    });
  },
})