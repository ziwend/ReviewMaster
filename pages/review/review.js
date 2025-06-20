const storage = require('../../utils/storage')

// 艾宾浩斯复习间隔（分钟）
const intervals = [5, 30, 12*60, 24*60, 2*24*60, 4*24*60, 7*24*60, 15*24*60, 30*24*60]

Page({
  data: {
    groups: [],
    groupId: null,
    currentGroup: {},
    reviewList: [],
    currentIndex: -1, // 使用索引来跟踪当前卡片
    current: null,
    showResult: false
  },
  onLoad: async function(options) {
    this.timerId = null; // 初始化定时器ID
    let { groupId } = options;
    const groups = await storage.getAllGroups();
    
    if (!groupId && groups && groups.length > 0) {
      groupId = groups[0].id;
    }

    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    
    this.setData({
      groups: groups || [],
      groupId: groupId,
      currentGroup: currentGroup
    });

    if (groupId) {
      await this.loadReviewList();
    }
  },

  onShow: async function() {
    // 从其他页面返回时，可能需要刷新数据
    if (this.data.groupId) {
      await this.loadReviewList();
    }
  },

  async loadReviewList() {
    const { groupId } = this.data
    if (!groupId) return
    const now = Date.now()
    const all = await storage.getGroupData(groupId) || [];
    const list = all.filter(k => k.nextReviewTime <= now)
    this.setData({
      reviewList: list,
      currentIndex: list.length > 0 ? 0 : -1,
      current: list[0] || null,
      showResult: false
    })
  },

  async markResult(e) {
    const result = e.currentTarget.dataset.result === 'true'
    let { current } = this.data
    if (!current) return

    // 清除可能存在的上一个定时器
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // 记录历史
    current.history.push({ time: Date.now(), result })

    if (result) {
      current.reviewCount += 1
      if (current.reviewCount >= intervals.length) {
        current.status = 'mastered'
      } else {
        current.status = 'reviewing'
        current.nextReviewTime = Date.now() + intervals[current.reviewCount-1]*60*1000
      }
      await storage.saveKnowledge(current)
      this.setData({ showResult: true }) // 先显示答案
      this.timerId = setTimeout(() => {
        this.nextOne()
      }, 1000) // 1秒后自动下一个
    } else {
      current.status = 'pending'
      current.reviewCount = 0
      current.nextReviewTime = Date.now() + intervals[0]*60*1000
      await storage.saveKnowledge(current)
      this.setData({ showResult: true }) // 没记住显示答案
      this.timerId = setTimeout(() => {
        this.nextOne();
      }, 3000); // 3秒后自动下一个
    }
  },

  nextOne() {
    // 如果有定时器，先清除
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    let { currentIndex, reviewList } = this.data;
    currentIndex++;
    if (currentIndex < reviewList.length) {
      this.setData({
        currentIndex: currentIndex,
        current: reviewList[currentIndex],
        showResult: false // 同步更新题目并隐藏答案
      });
    } else {
      // 复习完毕
      this.setData({
        current: null,
        currentIndex: -1,
        reviewList: [],
        showResult: false
      });
      wx.showToast({ title: '本轮复习完成！', icon: 'success' });
    }
  },

  toMastered() {
    const { groupId } = this.data
    console.log("选择group=", groupId);
    if (!groupId) {
      wx.showToast({ title: '分组ID缺失', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/mastered/mastered?groupId=${groupId}` })
  },
  
  /**
   * 页面隐藏时，清除定时器
   */
  onHide: function () {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  },

  /**
   * 页面卸载时，清除定时器
   */
  onUnload: function () {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
})