const storage = require('../../utils/storage')

Page({
  data: {
    groups: [],
    groupId: null,
    currentGroup: {},
    masteredList: [],
    isEmpty: false,
    page: 1,
    pageSize: 20,
    totalCount: 0,
    hasMore: false,
    totalPage: 0,
  },

  onLoad: async function (options) {
    const { groupId } = options;
    await this.initData(groupId);
  },

  onShow: async function () {
    // await this.initData();
  },

  initData: async function (groupId) {
    const groups = storage.getAllGroups();
    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({
        title: currentGroup.name
      });
    }
    this.setData({
      groupId,
      currentGroup,
      page: 1
    });
    await this.loadMasteredList(1);
  },


  loadMasteredList: async function (page = 1) {
    if (!this.data.groupId) {
      this.setData({ masteredList: [], isEmpty: true });
      return;
    }
    const settings = storage.getSettings();
    const pageSize = settings.batchSize || 20;
    const totalCount = this.data.currentGroup.masteredCount;
    const masteredList = storage.getMasteredPaged(this.data.groupId, page, pageSize);
    const totalPage = Math.ceil(totalCount / pageSize);
    this.setData({
      masteredList,
      isEmpty: masteredList.length === 0,
      page,
      pageSize,
      totalCount,
      totalPage,
      hasMore: page < totalPage
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
      await storage.removeKnowledge(id, groupId);
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