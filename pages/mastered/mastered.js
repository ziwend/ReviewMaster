const storage = require('../../utils/storage')

Page({
  data: {
    groups: [],
    groupId: null,
    currentGroup: {},
    masteredList: [],
    page: 1,
    pageSize: 20,
    hasMore: false,
    totalPage: 0,
  },

  onLoad: function (options) {
    const { groupId } = options;

    const groups = storage.getAllGroups();
    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({
        title: currentGroup.name
      });
    }

    const settings = storage.getSettings();
    const pageSize = settings.batchSize || 20;
    const totalPage = Math.ceil(currentGroup.masteredCount / pageSize);
    this.setData({
      groupId,
      currentGroup,
      pageSize,      
      totalPage,
      lastRefreshTime: Date.now() // 添加最后刷新时间
    });
    console.log("master on load ");
    this.loadMasteredList(1);
  },

  onShow: async function () {
    // 避免不必要的刷新和重复加载
    const now = Date.now();
    if (!this.data.lastRefreshTime || now - this.data.lastRefreshTime > 5000) {
      const groups = storage.getAllGroups();
      const currentGroup = groups.find(g => g.id == this.data.groupId) || {};
      
      // 如果掌握数量发生变化，重新加载列表
      if (currentGroup.masteredCount !== this.data.currentGroup.masteredCount) {
        this.setData({
          currentGroup,
          totalPage: Math.ceil(currentGroup.masteredCount / this.data.pageSize),
          lastRefreshTime: now
        });
        this.loadMasteredList(1);
      }
    }
  },

  loadMasteredList: async function (page = 1) { 
    const masteredList = storage.getMasteredPaged(this.data.groupId, page, this.data.pageSize);
    
    this.setData({
      masteredList,
      page,      
      hasMore: page < this.data.totalPage
    });
  },

  prevPage() {
    if (this.data.page > 1) {
      this.loadMasteredList(this.data.page - 1);
    }
  },

  nextPage() {
    if (this.data.page < this.data.totalPage) {
      this.loadMasteredList(this.data.page + 1);
    }
  },
  updateGroup: function() {
    const groups = storage.getAllGroups();
    const currentGroup = groups.find(g => g.id == this.data.groupId) || (groups && groups[0]) || {};

    this.setData({
      currentGroup,
    });
  },
  restoreKnowledge: async function (e) {
    const { id } = e.currentTarget.dataset;
    const knowledge = this.data.masteredList.find(k => k.id === id);
    if (knowledge) {
      knowledge.status = 'pending';
      knowledge.nextReviewTime = Date.now();
      knowledge.repetition = 0;
      wx.showToast({
        title: '正在恢复中请稍后',
        icon: 'success',
      });
      storage.saveKnowledge(knowledge);
      this.updateGroup();
      await this.loadMasteredList();

      wx.showToast({
        title: '已恢复',
        icon: 'success',
      });
    }
  },

  removeKnowledge: async function (e) {
    const id = e.currentTarget.dataset.id
    const { groupId } = this.data;
    if (!groupId) return;
    console.log("removeKnowledge", id, groupId);
    try {
      await new Promise((resolve, reject) => {
        wx.showModal({
          title: '删除知识点',
          content: '确定要删除该知识点吗？',
          success: res => res.confirm ? resolve() : reject(new Error('用户取消'))
        });
      });
      storage.removeKnowledge(groupId, id);
      this.updateGroup();
      await this.loadMasteredList();
    } catch (error) {
      // 用户取消，不做任何事
      console.log("removeKnowledge error", error);
    }
  },

  toGroups() {
    wx.navigateTo({ url: '/pages/groups/groups' })
  },
  goBack() {
    wx.reLaunch({ url: '/pages/groups/groups' })
  },
  // 新增：点击知识点显示复习记录
  showHistory(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/history/history?id=${id}`
    });
  },
})