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

// 在Page外部添加
let qSwipeHintThrottleTimer = null;
let lastQSwipeHint = '';
let lastQSwipeHintX = null;
let lastQSwipeHintY = null;

let aSwipeHintThrottleTimer = null;
let lastASwipeHint = '';
let lastASwipeHintX = null;
let lastASwipeHintY = null;

// 在滑动处理函数（如onQuestionTouchMove）中，替换原有setData逻辑：
function updateQSwipeHint(newHint, x, y) {
  if (
    newHint === lastQSwipeHint &&
    x === lastQSwipeHintX &&
    y === lastQSwipeHintY
  ) {
    return;
  }
  lastQSwipeHint = newHint;
  lastQSwipeHintX = x;
  lastQSwipeHintY = y;
  if (qSwipeHintThrottleTimer) return;
  qSwipeHintThrottleTimer = setTimeout(() => {
    this.setData({
      qSwipeHint: newHint,
      qSwipeHintX: x,
      qSwipeHintY: y
    });
    qSwipeHintThrottleTimer = null;
  }, 100);
}

function updateASwipeHint(newHint, x, y) {
  if (
    newHint === lastASwipeHint &&
    x === lastASwipeHintX &&
    y === lastASwipeHintY
  ) {
    return;
  }
  lastASwipeHint = newHint;
  lastASwipeHintX = x;
  lastASwipeHintY = y;
  if (aSwipeHintThrottleTimer) return;
  aSwipeHintThrottleTimer = setTimeout(() => {
    this.setData({
      aSwipeHint: newHint,
      aSwipeHintX: x,
      aSwipeHintY: y
    });
    aSwipeHintThrottleTimer = null;
  }, 100);
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
    gestureGuideTouchStartY: 0,
    qTouchStartY: 0,
    qTouchDeltaY: 0,
    aTouchStartX: 0,
    aTouchDeltaX: 0,
    qSwipeHint: '', // 问题区滑动提示
    qSwipeHintX: null,
    qSwipeHintY: null,
    aSwipeHint: '', // 答案区滑动提示
    aSwipeHintX: null,
    aSwipeHintY: null,
    remainingCount: 0, // 新增：剩余待复习数量
    mastered: [], // 新增：已掌握知识点列表
    unlearned: [] // 新增：未学会知识点列表
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
    // 新增：获取 mastered 和 unlearned
    const allKnowledge = storage.getGroupData(groupId) || [];
    const mastered = allKnowledge.filter(k => k.status === 'mastered');
    const unlearned = allKnowledge.filter(k => !k.learned);
    this.setData({ fullReviewList, mastered, unlearned });
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
      loading: false, // 这里确保关闭 loading
      showResult: false, // 新增，切换批次时重置答案显示
      showDeleteButton: false // 新增，切换批次时重置删除按钮
    });
  },

  // 统一处理复习反馈
  handleReviewFeedback(type) {
    const quality = FEEDBACK_SCORE[type.toUpperCase()] || 0;
    let { current, groupId } = this.data;
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
      // 新增：优先用分组efactor
      const settings = storage.getSettings();
      let groupEfactor = (settings.groupEfactorMap && settings.groupEfactorMap[groupId]) || settings.efactor || 2.5;
      if (typeof current.efactor === 'undefined') current.efactor = groupEfactor;
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

  async nextOne() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    let { currentIndex, reviewList, batchSize, groupId } = this.data;
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
      // 本批次用完，主动刷新所有分组的今日批次
      await storage.refreshAllReviewLists();
      const latestBatch = await storage.getTodayReviewList(groupId, batchSize);
      const todayList = await storage.getTodayReviewList(groupId, batchSize);
      if (latestBatch && latestBatch.length > 0) {
        this.setData({
          isBatchCompleted: true,
          isAllReviewed: false,
          fullReviewList: latestBatch.map(k => k.id),
          reviewList: [],
          current: null,
          currentIndex: -1,
          remainingCount: todayList.length,
          mastered: [],
          unlearned: []
        });
        // 新增：刷新 mastered 和 unlearned
        const allKnowledge = storage.getGroupData(groupId) || [];
        const mastered = allKnowledge.filter(k => k.status === 'mastered');
        const unlearned = allKnowledge.filter(k => !k.learned);
        this.setData({
          isBatchCompleted: true,
          isAllReviewed: false,
          fullReviewList: latestBatch.map(k => k.id),
          reviewList: [],
          current: null,
          currentIndex: -1,
          remainingCount: todayList.length,
          mastered,
          unlearned
        });
      } else {
        this.setData({
          isBatchCompleted: false,
          isAllReviewed: true,
          fullReviewList: [],
          reviewList: [],
          current: null,
          currentIndex: -1,
          remainingCount: 0,
          mastered: [],
          unlearned: []
        });
        // 新增：刷新 mastered 和 unlearned
        const allKnowledge = storage.getGroupData(groupId) || [];
        const mastered = allKnowledge.filter(k => k.status === 'mastered');
        const unlearned = allKnowledge.filter(k => !k.learned);
        this.setData({
          isBatchCompleted: false,
          isAllReviewed: true,
          fullReviewList: [],
          reviewList: [],
          current: null,
          currentIndex: -1,
          remainingCount: 0,
          mastered,
          unlearned
        });
      }
    }
  },

  prevOne() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

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
          if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
          }
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

  // 题目区：只处理上下滑
  onQuestionTouchStart(e) {
    this.qTouchStartY = e.touches[0].clientY;
    this.qTouchDeltaY = 0;
  },
  onQuestionTouchMove(e) {
    this.qTouchDeltaY = e.touches[0].clientY - this.qTouchStartY;
    // 新增：上下滑动提示
    const threshold = 30;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;
    if (this.qTouchDeltaY <= -threshold) {
      updateQSwipeHint.call(this, '上滑表示没记住', clientX, clientY);
    } else if (this.qTouchDeltaY >= threshold) {
      updateQSwipeHint.call(this, '下滑表示记住了', clientX, clientY);
    } else {
      updateQSwipeHint.call(this, '', clientX, clientY);
    }
  },
  onQuestionTouchEnd(e) {
    const thresholdY = 60;
    const question = this.data.current?.question || '';
    if (this.qTouchDeltaY >= thresholdY) {      
      this.markResult({ currentTarget: { dataset: { result: 'remember' } } });
    } else if (this.qTouchDeltaY <= -thresholdY) {
      this.markResult({ currentTarget: { dataset: { result: 'forget' } } });
    }
    this.qTouchStartY = 0;
    this.qTouchDeltaY = 0;
    if (qSwipeHintThrottleTimer) {
      clearTimeout(qSwipeHintThrottleTimer);
      qSwipeHintThrottleTimer = null;
    }
    this.setData({
      qSwipeHint: '',
      qSwipeHintX: null,
      qSwipeHintY: null
    });
    lastQSwipeHint = '';
    lastQSwipeHintX = null;
    lastQSwipeHintY = null;
  },

  // 答案区：只处理左右滑
  onAnswerTouchStart(e) {
    this.aTouchStartX = e.touches[0].clientX;
    this.aTouchDeltaX = 0;
  },
  onAnswerTouchMove(e) {
    this.aTouchDeltaX = e.touches[0].clientX - this.aTouchStartX;
    // 新增：左右滑动提示
    const threshold = 30;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;
    if (this.aTouchDeltaX <= -threshold) {
      updateASwipeHint.call(this, '左滑表示切换下一个', clientX, clientY);
    } else if (this.aTouchDeltaX >= threshold) {
      updateASwipeHint.call(this, '右滑表示切换上一个', clientX, clientY);
    } else {
      updateASwipeHint.call(this, '', clientX, clientY);
    }
  },
  onAnswerTouchEnd(e) {
    const thresholdX = 60;
    if (this.aTouchDeltaX <= -thresholdX) {
      this.nextOne();
    } else if (this.aTouchDeltaX >= thresholdX) {
      this.prevOne();
    }
    this.aTouchStartX = 0;
    this.aTouchDeltaX = 0;
    if (aSwipeHintThrottleTimer) {
      clearTimeout(aSwipeHintThrottleTimer);
      aSwipeHintThrottleTimer = null;
    }
    this.setData({
      aSwipeHint: '',
      aSwipeHintX: null,
      aSwipeHintY: null
    });
    lastASwipeHint = '';
    lastASwipeHintX = null;
    lastASwipeHintY = null;
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
