// review.js
const storage = require('../../utils/storage')
const { createSwipeHandler } = require('../../utils/swipeHint')

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

// 创建问题和答案区域的手势处理器
const qSwipeHandler = createSwipeHandler('q');
const aSwipeHandler = createSwipeHandler('a');

Page({
  data: {
    reviewList: [], // 当前批次待复习知识点
    currentIndex: 0,
    current: null,
    pageReady: false,
    isBatchCompleted: false,
    isAllReviewed: false,
    currentBatchIndex: 0,
    totalBatchCount: 0,
    groupId: null,
    page: 1, // 当前分页页码
    hasMore: true,
    cardTranslateX: 0,
    cardTransition: '',
    showResult: false,
    loading: true,
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
    reviewBatchSize: 20,
    batchPage: 1,
    currentGroup: {},
    touchStartX: 0,
    touchStartY: 0,
    touchDeltaX: 0,
    touchDeltaY: 0,
    showGestureGuide: true,
    gestureGuideActive: true,
    gestureGuideTouchStartY: 0,
    masteredCount: 0,
    unlearnedCount: 0,
    remainingCount: 0,
  },

  settings: {}, // 存储设置

  onLoad: function (options) {
    const { groupId } = options;

    const groups = getApp().globalData.groups;
    const currentGroup = groups.find(g => g.id == groupId) || {};
    if (currentGroup.name) {
      wx.setNavigationBarTitle({ title: currentGroup.name });
    }
    const hideGuide = wx.getStorageSync('hideReviewGestureGuide');
    this.settings = storage.getSettings();
    this.setData({
      groupId,
      showGestureGuide: !hideGuide,
      gestureGuideActive: !hideGuide,
    });
  },

  onShow: function () {
    if (this.data.groupId) {
      this.setData({ page: 1 }, () => {
        this.loadNextBatchCore();
      });
    }
  },

  loadNextBatch() {
    if (!this.data.hasMore) return;
    this.setData({
      page: this.data.page + 1,
      isBatchCompleted: false
    }, () => {
      this.loadNextBatchCore();
    });
  },

  loadNextBatchCore() {
    const { groupId, page } = this.data;
    const pageSize = this.settings.reviewBatchSize || 20;
    const allDueList = storage.getTodayReviewList(groupId);
    const reviewList = allDueList.slice((page - 1) * pageSize, page * pageSize);
    const totalCount = allDueList.length;
    const hasMore = (page * pageSize) < totalCount;
    let current = reviewList.length ? { ...reviewList[0] } : null;
    if (current) {
      current.lastRememberAgo = this.getLastRememberAgo(current);
    }
    const totalBatchCount = Math.ceil(totalCount / pageSize);
    const currentBatchIndex = page;
    this.setData({
      reviewList,
      current,
      currentIndex: 0,
      isBatchCompleted: false,
      isAllReviewed: totalCount === 0,
      pageReady: true,
      hasMore,
      currentBatchIndex,
      totalBatchCount,
      masteredCount: storage.getMasteredCount(groupId),
      unlearnedCount: storage.getUnlearnedCount(groupId),
      remainingCount: totalCount - (page - 1) * pageSize
    });
    storage.reportPerf();
  },

  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({
      page: this.data.page + 1
    }, () => {
      this.loadNextBatch();
    });
  },

  resetPaging() {
    this.setData({
      page: 1
    }, () => {
      this.loadNextBatch();
    });
  },

  handleBatchCompleted() {
    const { groupId, page, reviewList } = this.data;
    // 计算剩余待复习数量
    const allDueList = storage.getTodayReviewList(groupId);
    const pageSize = this.settings.reviewBatchSize || 20;
    const totalCount = allDueList.length;
    const completedCount = page * pageSize > totalCount ? totalCount : page * pageSize;
    const remainingCount = totalCount - completedCount;
    this.setData({
      isBatchCompleted: true,
      current: null,
      reviewList: [],
      remainingCount: remainingCount < 0 ? 0 : remainingCount,
      isAllReviewed: remainingCount === 0,
    });
    this.updateCounts();
  },

  updateCounts() {
    setTimeout(() => {
      this.setData({
        masteredCount: storage.getMasteredCount(this.data.groupId),
        unlearnedCount: storage.getUnlearnedCount(this.data.groupId),
      });
    }, 200);
  },

  nextOne() {
    let { reviewList, currentIndex } = this.data;
    const currentKnowledge = reviewList[currentIndex];
    if (!currentKnowledge || !currentKnowledge.id) return;
    if (currentIndex < reviewList.length - 1) {
      let nextCurrent = reviewList[currentIndex + 1];
      if (nextCurrent) {
        nextCurrent = { ...nextCurrent, lastRememberAgo: this.getLastRememberAgo(nextCurrent) };
      }
      this.setData({
        currentIndex: currentIndex + 1,
        current: nextCurrent,
        cardTranslateX: 0,
        cardTransition: '',
        showResult: false,
      }, () => {
        this.touchStartX = 0;
        this.touchDeltaX = 0;
      });
    } else {
      this.handleBatchCompleted();
    }
  },

  // 统一处理复习反馈
  handleReviewFeedback(type) {
    const quality = FEEDBACK_SCORE[type.toUpperCase()] || 0;
    let { current, groupId } = this.data;

    // 首次复习时初始化算法字段
    if (!current.learned) {
      current.learned = true;
      // 初始化SM-2算法字段
      if (typeof current.repetition === 'undefined') current.repetition = 0;
      // 新增：优先用分组efactor
      let groupEfactor = (this.settings.groupEfactorMap && this.settings.groupEfactorMap[groupId]) || this.settings.efactor || 2.5;
      if (typeof current.efactor === 'undefined') current.efactor = groupEfactor;
    }
    // 使用SM-2算法更新知识点
    current = storage.updateKnowledgeBySM2(current, quality);
    // 严格掌握条件：连续5次正确且易记因子≥2.5
    if (current.repetition >= 5 && current.efactor >= 2.5) {
      current.status = 'mastered';
    }
    // 普通复习状态
    else if (current.efactor >= 2.0) {
      current.status = 'reviewing';
    }
    // 需重新学习
    else {
      current.status = 'pending';
    }
    storage.saveKnowledge(current);
  },

  // markResult 统一调用
  async markResult(e) {
    const type = e.currentTarget.dataset.result;
    this.handleReviewFeedback(type);
    this.nextOne();
  },

  // markResultBySwipe 统一调用
  markResultBySwipe(result) {
    // result: true/false
    const type = result ? 'remember' : 'forget';
    this.handleReviewFeedback(type);
  },

  prevOne() {
    const { currentIndex, batchReviewIds } = this.data;
    if (currentIndex <= 0) return;

    const newIndex = currentIndex - 1;
    const current = storage.getKnowledgeById(batchReviewIds[newIndex]);
    if (!current) return;

    // 复用结果状态计算逻辑
    const lastAction = current.history?.slice(-1)[0];
    const showResult = !!lastAction?.quality;

    current.lastRememberAgo = this.getLastRememberAgo(current);

    this.setData({
      currentIndex: newIndex,
      current,
      showResult      
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
  onHide: function () {},

  /**
   * 页面卸载时，清除定时器
   */
  onUnload: function () {},


  // 题目区：只处理上下滑
  onQuestionTouchStart(e) {
    this.qTouchStartY = e.touches[0].clientY;
    this.qTouchDeltaY = 0;
  },
  onQuestionTouchMove(e) {
    this.qTouchDeltaY = e.touches[0].clientY - this.qTouchStartY;
    const threshold = 30;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;

    let hint = '';
    if (this.qTouchDeltaY <= -threshold) {
      hint = '上滑显示答案';
    } else if (this.qTouchDeltaY >= threshold) {
      hint = '下滑显示答案';
    }
    qSwipeHandler.updateHint.call(this, hint, clientX, clientY);
  },
  onQuestionTouchEnd(e) {
    const thresholdY = 60;
    if (this.qTouchDeltaY >= thresholdY) {
      //
      this.setData({
        showResult: true
      });
    } else if (this.qTouchDeltaY <= -thresholdY) {
      // 
      this.setData({
        showResult: true
      });
    }
    this.qTouchStartY = 0;
    this.qTouchDeltaY = 0;
    qSwipeHandler.reset.call(this);
  },

  // 答案区：只处理左右滑
  onAnswerTouchStart(e) {
    this.aTouchStartX = e.touches[0].clientX;
    this.aTouchDeltaX = 0;
  },

  onAnswerTouchMove(e) {
    this.aTouchDeltaX = e.touches[0].clientX - this.aTouchStartX;
    // 新增：滑动方向提示和位置
    const threshold = 60;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;

    let hint = '';
    if (this.aTouchDeltaX <= -threshold) {
      // 卡片跟随手指移动
      this.setData({
        cardTranslateX: this.aTouchDeltaX,
        cardTransition: ''
      });
      hint = '左滑表示已记住';
    } else if (this.aTouchDeltaX >= threshold) {
      // 卡片跟随手指移动
      this.setData({
        cardTranslateX: this.aTouchDeltaX,
        cardTransition: ''
      });
      hint = '右滑表示没记住';
    }
    aSwipeHandler.updateHint.call(this, hint, clientX, clientY);
  },

  onAnswerTouchEnd(e) {
    const threshold = 60;
    let animateOut = false;
    let direction = 0;
    if (this.aTouchDeltaX <= -threshold) {
      // 左滑，已学会
      animateOut = true;
      direction = -1; // 左滑
    } else if (this.aTouchDeltaX >= threshold) {
      // 右滑，已学会
      animateOut = true;
      direction = 1; // 右滑
    }
    if (animateOut) {
      // 先执行动画再更新数据
      this.setData({
        cardTranslateX: direction * 750,
        cardTransition: 'transform 0.3s cubic-bezier(.4,2,.6,1)'
      }, () => {
        setTimeout(() => {
          if (direction === -1) {
            this.markResult({ currentTarget: { dataset: { result: 'remember' } } });            
          } else if (direction === 1) {
            this.markResult({ currentTarget: { dataset: { result: 'forget' } } });
          }
          this.setData({
            cardTranslateX: 0
          }); // 重置位置要在数据更新之后
        }, 300);
      });

      // 重置触摸状态
      this.aTouchStartX = 0;
      this.aTouchDeltaX = 0;
    } else {
      this.setData({
        cardTranslateX: 0,
        cardTransition: 'transform 0.2s'
      });
    }
    aSwipeHandler.reset.call(this);
  },

  /**
   * 计算知识点最后记忆时间描述
   * 优化：返回"xx前记住了/模糊/没记住"
   */
  getLastRememberAgo(current) {
    if (!current?.history?.length) return '';
    // 取最后一次有quality的记录
    const last = [...current.history].reverse().find(h => typeof h.quality === 'number');
    if (!last) return '';
    let feedback = '';
    if (last.quality >= 5) feedback = '记住了';
    else if (last.quality >= 3) feedback = '模糊';
    else feedback = '没记住';
    return `${formatTimeAgo(last.time)}${feedback}`;
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
        success: (res) => {
          if (res.confirm) {
            this.markResult({ currentTarget: { dataset: { result: 'remember' } } });
          }
        }
      });
    } else if (deltaY <= -60) {
      // 上滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideReviewGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向上滑动，表示没记住',
        showCancel: false,
        success: (res) => {
          if (res.confirm) {
            this.markResult({ currentTarget: { dataset: { result: 'forget' } } });
          }
        }
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
