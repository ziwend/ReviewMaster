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
    showResult: false,
    loading: true,
    currentStat: {
      index: 0,
      total: 0,
      reviewCount: 0,
      remembered: 0,
      forgotten: 0,
      lastReviewAgo: ''
    }
  },
  onLoad: async function(options) {
    this.timerId = null; // 初始化定时器ID
    let { groupId } = options;
    const groups = await storage.getAllGroups();
    console.log("review执行getAllGroups，groupId=", groupId);
    if (!groupId && groups && groups.length > 0) {
      groupId = groups[0].id;
    }

    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    
    this.setData({
      groups: groups || [],
      groupId: groupId,
      currentGroup: currentGroup,
      loading: true
    });

    if (groupId) {
      await this.loadReviewList();
      console.log("review执行loadReviewList，groupId=", groupId);
    } else {
      this.setData({ loading: false });
    }
  },

  onShow: async function() {
    // 从其他页面返回时，可能需要刷新数据
    if (this.data.groupId) {
      this.setData({ loading: true });
      await this.loadReviewList();
    }
  },

  async loadReviewList() {
    const { groupId } = this.data;
    if (!groupId) {
      this.setData({ loading: false });
      return;
    }
    const groupKey = `group-${groupId}`;
    const knowledgeIds = wx.getStorageSync(groupKey) || [];
    const BATCH_SIZE = 20;
    let reviewList = [];
    let current = null;
    let currentIndex = -1;
    const now = Date.now();

    const loadBatch = (start) => {
      const end = Math.min(start + BATCH_SIZE, knowledgeIds.length);
      for (let i = start; i < end; i++) {
        const k = wx.getStorageSync(`knowledge-${knowledgeIds[i]}`);
        if (k && k.nextReviewTime <= now) {
          reviewList.push(k);
          if (current === null) {
            current = k;
            currentIndex = 0;
            this.setData({
              reviewList: [k],
              currentIndex: 0,
              current: k,
              showResult: false,
              loading: false
            }, () => {
              this.updateCurrentStat();
            });
          } else {
            this.setData({
              reviewList: [...reviewList]
            }, () => {
              this.updateCurrentStat();
            });
          }
        }
      }
      if (end < knowledgeIds.length) {
        setTimeout(() => loadBatch(end), 0);
      } else if (reviewList.length === 0) {
        this.setData({
          reviewList: [],
          currentIndex: -1,
          current: null,
          showResult: false,
          loading: false
        }, () => {
          this.updateCurrentStat();
        });
      }
    };

    this.setData({ loading: true });
    loadBatch(0);
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
      this.setData({ showResult: true }, () => {
        this.updateCurrentStat();
      });
      this.timerId = setTimeout(() => {
        this.nextOne()
      }, 1000) // 1秒后自动下一个
    } else {
      current.status = 'pending'
      current.reviewCount = 0
      current.nextReviewTime = Date.now() + intervals[0]*60*1000
      await storage.saveKnowledge(current)
      this.setData({ showResult: true }, () => {
        this.updateCurrentStat();
      });
      this.timerId = setTimeout(() => {
        this.nextOne();
      }, 3000); // 3秒后自动下一个
    }
  },

  nextOne() {
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
        showResult: false
      }, () => {
        this.updateCurrentStat();
      });
    } else {
      this.setData({
        current: null,
        currentIndex: -1,
        reviewList: [],
        showResult: false
      }, () => {
        this.updateCurrentStat();
      });
      wx.showToast({ title: '本轮复习完成！', icon: 'success' });
    }
  },

  toMastered() {
    const { groupId } = this.data
    console.log("review to master选择group=", groupId);
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
  },

  // 计算当前知识点的统计信息
  computeCurrentStat() {
    const { reviewList, currentIndex, current } = this.data;
    if (!current) return {
      index: 0,
      total: reviewList.length,
      reviewCount: 0,
      remembered: 0,
      forgotten: 0,
      lastReviewAgo: ''
    };
    const total = reviewList.length;
    const index = currentIndex + 1;
    const history = current.history || [];
    const reviewCount = history.length;
    let remembered = 0, forgotten = 0, lastReviewAgo = '';
    if (reviewCount > 0) {
      remembered = history.filter(h => h.result).length;
      forgotten = history.filter(h => !h.result).length;
      const last = history[history.length - 1];
      const now = Date.now();
      const diff = now - last.time;
      if (diff < 60 * 1000) {
        lastReviewAgo = Math.floor(diff / 1000) + '秒前';
      } else if (diff < 60 * 60 * 1000) {
        lastReviewAgo = Math.floor(diff / 60000) + '分钟前';
      } else if (diff < 24 * 60 * 60 * 1000) {
        lastReviewAgo = Math.floor(diff / 3600000) + '小时前';
      } else {
        lastReviewAgo = Math.floor(diff / 86400000) + '天前';
      }
    }
    return {
      index,
      total,
      reviewCount,
      remembered,
      forgotten,
      lastReviewAgo
    };
  },

  // 在切换题目、加载数据后都更新统计
  updateCurrentStat() {
    this.setData({ currentStat: this.computeCurrentStat() });
  },

  async deleteCurrentKnowledge() {
    const { current, groupId, reviewList, currentIndex } = this.data;
    if (!current || !groupId) return;
    const that = this;
    wx.showModal({
      title: '删除确认',
      content: '确定要彻底删除该知识点吗？此操作不可撤销。',
      success: async (res) => {
        if (res.confirm) {
          // 删除本地存储
          const storage = require('../../utils/storage');
          await storage.removeKnowledge(groupId, current.id);
          // 更新 groupKnowledgeCountMap 缓存（如有）
          try {
            const app = getApp();
            if (app.globalData && app.globalData.groupKnowledgeCountMap) {
              const map = app.globalData.groupKnowledgeCountMap;
              map[groupId] = Math.max(0, (map[groupId] || 1) - 1);
            }
          } catch (e) {}
          // 从 reviewList 移除
          const newList = reviewList.filter(k => k.id !== current.id);
          let newCurrent = null, newIndex = -1;
          if (newList.length > 0) {
            newIndex = Math.min(currentIndex, newList.length - 1);
            newCurrent = newList[newIndex];
          }
          that.setData({
            reviewList: newList,
            current: newCurrent,
            currentIndex: newIndex,
            showResult: false
          }, () => {
            that.updateCurrentStat();
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  }
})