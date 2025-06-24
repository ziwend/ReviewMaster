const storage = require('../../utils/storage')

// 艾宾浩斯复习间隔（分钟）
// 基于记忆强度的自适应间隔算法
function calculateNextInterval(memoryStrength, difficulty, currentInterval) {
  // 基础调整因子 (记忆强度越高，间隔增长越快)
  const strengthFactor = 1 + (memoryStrength / 100);
  // 难度调整因子 (难度越高，间隔增长越慢)
  const difficultyFactor = 1.5 - (difficulty * 0.1);
  // 计算新间隔
  let newInterval = currentInterval * strengthFactor * difficultyFactor;
  
  // 确保间隔在合理范围内 (5分钟到60天)
  return Math.max(5, Math.min(newInterval, 60*24*60));
}
const BATCH_SIZE = 20; // 每天最大复习数

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
    isBatchCompleted: false, // 新增：是否完成一个批次
    touchStartX: 0,
    touchDeltaX: 0
  },

  // 用于存储完整复习列表和当前进度
  fullReviewList: [],
  globalIndex: 0,

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
      console.log('导入后分组知识点：', storage.getGroupData(groupId));
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
    storage.resetTodayReviewListIfNeeded(groupId);
    const todayList = storage.getTodayReviewList(groupId, BATCH_SIZE);
    console.log("review执行loadReviewList, todayList=", todayList);
    console.log('当前分组知识点：', storage.getGroupData(groupId));
    console.log('todayList =', todayList);
    if (todayList.length === 0) {
      this.setData({
        reviewList: [],
        current: null,
        currentIndex: -1,
        loading: false
      });
      return;
    }
    let current = todayList[0];
    if (current) current.lastRememberAgo = getLastRememberAgo(current);
    this.setData({
      reviewList: todayList,
      current: current,
      currentIndex: 0,
      isBatchCompleted: false,
      loading: false
    });
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

    // 更新记忆强度和难度
    if (result) {
      // 回答正确：提高记忆强度，降低难度
      current.memoryStrength = Math.min(100, current.memoryStrength + 15 + (current.difficulty * 2));
      current.difficulty = Math.max(1, current.difficulty - 0.1);
    } else {
      // 回答错误：降低记忆强度，提高难度
      current.memoryStrength = Math.max(0, current.memoryStrength - 25 - (current.difficulty * 3));
      current.difficulty = Math.min(5, current.difficulty + 0.2);
    }
    
    // 计算下次复习间隔
    current.lastInterval = calculateNextInterval(
      current.memoryStrength, 
      current.difficulty, 
      current.lastInterval || 5 // 初始间隔5分钟
    );
    
    current.nextReviewTime = Date.now() + current.lastInterval * 60 * 1000;
    
    // 更新状态
    current.reviewCount += 1;
    if (current.memoryStrength >= 95) {
      current.status = 'mastered';
    } else if (current.memoryStrength >= 50) {
      current.status = 'reviewing';
    } else {
      current.status = 'pending';
    }
    
    await storage.saveKnowledge(current);
    this.setData({ showResult: true });
    
    // 设置自动翻页定时器
    const delay = result ? 10000 : 30000; // 记得10秒，不记得30秒
    this.timerId = setTimeout(() => {
      this.nextOne();
    }, delay);
  },

  nextOne() {
    console.log("review执行nextOne");
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    let { currentIndex, reviewList } = this.data;
    currentIndex++;
    if (currentIndex < reviewList.length) {
      this.globalIndex++;
      let current = reviewList[currentIndex];
      if (current) current.lastRememberAgo = getLastRememberAgo(current);
      this.setData({
        currentIndex: currentIndex,
        current: current,
        showResult: false
      });
    } else {
      this.setData({
        current: null,
        currentIndex: -1,
        reviewList: [],
        isBatchCompleted: true
      });
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

  async deleteCurrentKnowledge() {
    const { current, groupId, reviewList, currentIndex } = this.data;
    if (!current || !groupId) return;
    const that = this;
    wx.showModal({
      title: '删除确认',
      content: '确定要彻底删除该知识点吗？此操作不可撤销。',
      success: async (res) => {
        if (res.confirm) {
          const storage = require('../../utils/storage');
          await storage.removeKnowledge(groupId, current.id);
          try {
            const app = getApp();
            if (app.globalData && app.globalData.groupKnowledgeCountMap) {
              const map = app.globalData.groupKnowledgeCountMap;
              map[groupId] = Math.max(0, (map[groupId] || 1) - 1);
            }
          } catch (e) {}
          const newList = reviewList.filter(k => k.id !== current.id);
          let newCurrent = null, newIndex = -1;
          if (newList.length > 0) {
            newIndex = Math.min(currentIndex, newList.length - 1);
            newCurrent = newList[newIndex];
            if (newCurrent) newCurrent.lastRememberAgo = getLastRememberAgo(newCurrent);
          }
          that.setData({
            reviewList: newList,
            current: newCurrent,
            currentIndex: newIndex,
            showResult: false
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  onTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    this.touchDeltaX = 0;
  },

  onTouchMove(e) {
    const moveX = e.touches[0].clientX;
    this.touchDeltaX = moveX - this.touchStartX;
    // 可选：可在此处做视觉反馈
  },

  onTouchEnd(e) {
    const threshold = 60; // 滑动阈值(px)
    if (this.touchDeltaX <= -threshold) {
      // 向左滑动，没记住
      this.markResultBySwipe(false);
    } else if (this.touchDeltaX >= threshold) {
      // 向右滑动，记住了
      this.markResultBySwipe(true);
    }
    // 重置
    this.touchStartX = 0;
    this.touchDeltaX = 0;
  },

  markResultBySwipe(result) {
    // 复用 markResult 逻辑
    const e = { currentTarget: { dataset: { result: String(result) } } };
    this.markResult(e);
  }
})

// 新增：计算最后一次记住时间的工具函数
function getLastRememberAgo(current) {
  if (!current || !current.history || current.history.length === 0) return '';
  // 找到最后一次记住的历史
  const lastRemember = (current.history || []).slice().reverse().find(h => h.result);
  if (!lastRemember) return '';
  const now = Date.now();
  const diff = now - lastRemember.time;
  if (diff < 60 * 1000) return Math.floor(diff / 1000) + '秒前';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}
