const storage = require('../../utils/storage')

// 常量定义
const FEEDBACK_SCORE = {
  REMEMBER: 5, // 记住了
  VAGUE: 3,   // 模糊
  FORGET: 1   // 没记住
};

// 时间格式化工具函数
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 60 * 1000) return Math.floor(diff / 1000) + '秒前';
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}

Page({
  data: {
    groups: [],
    groupId: null,
    currentGroup: {},
    fullReviewList: [], // 新增：全量待复习id
    reviewList: [], // 当前批次待复习id
    currentIndex: -1,
    current: null,
    showResult: false,
    loading: true,
    isBatchCompleted: false, // 当前批次已复习完
    isAllReviewed: false, // 所有待复习已复习完
    batchSize: 20,
    touchStartX: 0,
    touchStartY: 0,
    touchDeltaX: 0,
    touchDeltaY: 0,
    showDeleteButton: false,
    showGestureGuide: true,
    gestureGuideActive: true,
    gestureGuideTouchStartY: 0
  },

  settings: {}, // 存储设置

  onLoad: async function(options) {
    this.timerId = null;
    this.settings = storage.getSettings();
    let { groupId } = options;
    const groups = getApp().globalData.groups;
    if (!groupId && groups && groups.length > 0) {
      groupId = groups[0].id;
    }
    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({ title: currentGroup.name });
    }
    this.setData({
      groups: groups || [],
      groupId: groupId,
      currentGroup: currentGroup,
      loading: true,
      batchSize: this.settings.batchSize || 20
    });
    if (groupId) {
      await this.loadFullReviewList(groupId);
    } else {
      this.setData({ loading: false });
    }
    const hideGuide = wx.getStorageSync('hideReviewGestureGuide');
    this.setData({ showGestureGuide: !hideGuide, gestureGuideActive: !hideGuide });
  },

  onShow: function() {
    // 可选：如需定时刷新 dueCount，可在此实现
    // 不再全量调用 refreshAllReviewLists
  },

  async loadFullReviewList(groupId) {
    // 获取所有待复习id
    const cache = wx.getStorageSync(`todayReviewList-${groupId}`);
    const fullReviewList = cache && Array.isArray(cache.ids) ? cache.ids : [];
    this.setData({ fullReviewList });
    this.loadNextBatch();
  },

  loadNextBatch() {
    let { fullReviewList, batchSize } = this.data;
    if (!fullReviewList.length) {
      this.setData({ isAllReviewed: true, isBatchCompleted: false, reviewList: [], current: null, currentIndex: -1, loading: false });
      return;
    }
    const batch = fullReviewList.slice(0, batchSize);
    this.setData({
      reviewList: batch.map(id => storage.getKnowledgeById(id)).filter(Boolean),
      current: batch.length ? storage.getKnowledgeById(batch[0]) : null,
      currentIndex: 0,
      isBatchCompleted: false,
      isAllReviewed: false,
      loading: false // 这里确保关闭 loading
    });
  },

  // 统一处理复习反馈
  handleReviewFeedback(type) {
    const quality = FEEDBACK_SCORE[type.toUpperCase()] || 0;
    let { current } = this.data;
    if (!current) return;
    
    this.setData({ 
      showDeleteButton: type === 'remember',
      showResult: true 
    });
    
    // 首次复习时初始化算法字段
    if (!current.learned) {
      current.learned = true;
      // 初始化SM-2算法字段
      if (typeof current.repetition === 'undefined') current.repetition = 0;
      if (typeof current.efactor === 'undefined') current.efactor = 2.5;
    }
    
    // 使用SM-2算法更新知识点
    current = storage.updateKnowledgeBySM2(current, quality);
    // 状态判断
    if (current.efactor >= 2.5 && current.repetition >= 5) {
      current.status = 'mastered';
    } else if (current.efactor >= 2.0) {
      current.status = 'reviewing';
    } else {
      current.status = 'pending';
    }
    storage.saveKnowledge(current);
    current.lastRememberAgo = this.getLastRememberAgo(current);
    this.setData({ current });
    // 设置自动翻页定时器
    const delayInSeconds = quality >= 3 ? this.settings.delayRemember : this.settings.delayForget;
    const delay = delayInSeconds * 1000; // 转换为毫秒
    if (this.timerId) clearTimeout(this.timerId);
    this.timerId = setTimeout(() => {
      this.nextOne();
    }, delay);
  },

  // markResult 统一调用
  async markResult(e) {
    const type = e.currentTarget.dataset.result;
    this.handleReviewFeedback(type);
  },

  // markResultBySwipe 统一调用
  markResultBySwipe(result) {
    // result: true/false
    const type = result ? 'remember' : 'forget';
    this.handleReviewFeedback(type);
  },

  nextOne() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    let { currentIndex, reviewList, fullReviewList, batchSize } = this.data;
    currentIndex++;
    if (currentIndex < reviewList.length) {
      let current = reviewList[currentIndex];
      if (current) current.lastRememberAgo = this.getLastRememberAgo(current);
      this.setData({
        currentIndex: currentIndex,
        current: current,
        showResult: false,
        showDeleteButton: false
      });
    } else {
      // 本批复习完
      fullReviewList = fullReviewList.slice(batchSize);
      if (fullReviewList.length) {
        this.setData({ isBatchCompleted: true, fullReviewList, reviewList: [], current: null, currentIndex: -1 });
      } else {
        this.setData({ isAllReviewed: true, isBatchCompleted: false, fullReviewList: [], reviewList: [], current: null, currentIndex: -1 });
      }
    }
  },

  prevOne() {
    const { currentIndex, reviewList } = this.data;
    if (currentIndex <= 0) return;

    const newIndex = currentIndex - 1;
    const current = reviewList[newIndex];
    if (!current) return;

    // 复用结果状态计算逻辑
    const lastAction = current.history?.slice(-1)[0];
    const showResult = !!lastAction?.quality;
    const showDeleteButton = lastAction?.quality >= FEEDBACK_SCORE.REMEMBER;

    current.lastRememberAgo = this.getLastRememberAgo(current);
    
    this.setData({
      currentIndex: newIndex,
      current,
      showResult,
      showDeleteButton
    });
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
      const app = getApp();
      if (app.globalData?.groupKnowledgeCountMap) {
        const map = app.globalData.groupKnowledgeCountMap;
        map[groupId] = Math.max(0, (map[groupId] || 1) - 1);
      }
          const newList = reviewList.filter(k => k.id !== current.id);
          let newCurrent = null, newIndex = -1;
          if (newList.length > 0) {
            newIndex = Math.min(currentIndex, newList.length - 1);
            newCurrent = newList[newIndex];
            if (newCurrent) newCurrent.lastRememberAgo = this.getLastRememberAgo(newCurrent);
          }
          that.setData({
            reviewList: newList,
            current: newCurrent,
            currentIndex: newIndex,
            showResult: false,
            showDeleteButton: false
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  onTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
  },

  onTouchMove(e) {
    const moveX = e.touches[0].clientX;
    const moveY = e.touches[0].clientY;
    this.touchDeltaX = moveX - this.touchStartX;
    this.touchDeltaY = moveY - this.touchStartY;
    // 可选：可在此处做视觉反馈
  },

  onTouchEnd(e) {
    const thresholdX = 60; // 横向滑动阈值(px)
    const thresholdY = 60; // 纵向滑动阈值(px)
    // 优先判断纵向滑动
    if (this.touchDeltaY >= thresholdY) {
      // 下滑，记住了
      this.markResult({ currentTarget: { dataset: { result: 'remember' } } });
    } else if (this.touchDeltaY <= -thresholdY) {
      // 上滑，没记住
      this.markResult({ currentTarget: { dataset: { result: 'forget' } } });
    } else if (this.touchDeltaX <= -thresholdX) {
      // 左滑，下一题
      this.nextOne();
    } else if (this.touchDeltaX >= thresholdX) {
      // 右滑，上一题
      this.prevOne();
    }
    // 重置
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchDeltaX = 0;
    this.touchDeltaY = 0;
  },
  /**
   * 计算知识点最后记忆时间描述
   */
  getLastRememberAgo(current) {
    if (!current?.history?.length) return '';
    // 只要 quality >= 3 就算记住
    const lastRemember = [...current.history].reverse().find(h => h.quality >= 3);
    return lastRemember?.time ? formatTimeAgo(lastRemember.time) : '';
  },

  // 跳转去学习
  toLearnPage() {
    const { groups, groupId } = this.data;
    const id = groupId || (groups[0] && groups[0].id);
    wx.navigateTo({ url: `/pages/learn/learn?groupId=${id}` });
  },

  onGestureGuideTouchStart(e) {
    this.setData({ gestureGuideTouchStartY: e.touches[0].clientY });
  },

  onGestureGuideTouchEnd(e) {
    if (!this.data.gestureGuideActive) return;
    const deltaY = e.changedTouches[0].clientY - this.data.gestureGuideTouchStartY;
    if (deltaY >= 60) {
      // 下滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideReviewGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向下滑动，表示记住了',
        showCancel: false,
        success: () => { this.markResult({ currentTarget: { dataset: { result: 'remember' } } }); }
      });
    } else if (deltaY <= -60) {
      // 上滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideReviewGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向上滑动，表示没记住',
        showCancel: false,
        success: () => { this.markResult({ currentTarget: { dataset: { result: 'forget' } } }); }
      });
    }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.previewImage({
        current: url,
        urls: [url]
      });
    }
  }
})
