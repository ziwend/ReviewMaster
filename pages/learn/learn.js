// learn.js
const storage = require('../../utils/storage');

// 时间戳转友好时间
function fromNow(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff/60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff/3600)}小时前`;
  return `${Math.floor(diff/86400)}天前`;
}

// 在Page外部添加
let swipeHintThrottleTimer = null;
let lastSwipeHint = '';
let lastSwipeHintX = null;
let lastSwipeHintY = null;

// 在滑动处理函数（如onTouchMove）中，替换原有setData逻辑：
function updateSwipeHint(newHint, x, y) {
  if (
    newHint === lastSwipeHint &&
    x === lastSwipeHintX &&
    y === lastSwipeHintY
  ) {
    return;
  }
  lastSwipeHint = newHint;
  lastSwipeHintX = x;
  lastSwipeHintY = y;
  if (swipeHintThrottleTimer) return;
  swipeHintThrottleTimer = setTimeout(() => {
    this.setData({
      swipeHint: newHint,
      swipeHintX: x,
      swipeHintY: y
    });
    swipeHintThrottleTimer = null;
  }, 100);
}

Page({
  data: {
    fullUnlearnedList: [], // 新增：全量未学会id
    unlearnedList: [], // 当前批次未学会id
    currentIndex: 0,
    current: null,
    pageReady: false, // 页面是否准备好渲染
    isBatchCompleted: false, // 当前批次已学完
    isAllLearned: false, // 所有未学会已学完
    batchSize: 20, // 默认，后续用 storage.getSettings()
    showGestureGuide: true,
    gestureGuideActive: true,
    gestureGuideTouchStartX: 0,
    currentBatchIndex: 0,
    totalBatchCount: 0,
    initialUnlearnedCount: null, // 用于精确计算批次
    swipeHint: '', // 新增：滑动提示文本
    swipeHintX: null, // 新增：滑动提示横坐标
    swipeHintY: null, // 新增：滑动提示纵坐标
    groupId: null // 关键：写入data，便于后续分组定位
  },

  onLoad(options) {
    const groups = getApp().globalData.groups;
    let { groupId } = options;

    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({ title: currentGroup.name });
    }
    const hideGuide = wx.getStorageSync('hideLearnGestureGuide');
    this.setData({ 
      showGestureGuide: !hideGuide, 
      gestureGuideActive: !hideGuide,
      initialUnlearnedCount: null, // 每次加载页面重置，开始新的学习会话
      groupId // 关键：写入data，便于后续分组定位
    });
  },

  onShow: async function() {
    this.setData({ pageReady: false }); // 页面加载前，设置为未就绪
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const settings = storage.getSettings();
      this.setData({ batchSize: settings.batchSize || 20 });
      this.refreshGroupsAndData();
    } catch (e) {
      console.error('首页数据刷新失败', e);
    } finally {
      wx.hideLoading();
    }
  },

  refreshGroupsAndData() {
    const { groupId } = this.data;
    if (groupId) {
      this.loadFullUnlearned(groupId);
    } else {
      this.setData({
        fullUnlearnedList: [],
        unlearnedList: [],
        current: null,
        currentIndex: 0,
        isBatchCompleted: false,
        isAllLearned: true, // 没有任何内容，即全部已学
        pageReady: true // 页面已就绪
      });
      wx.showModal({
        title: '提示',
        content: '请先新建学习分组，并导入待学习内容！',
        showCancel: false,
        confirmText: '去新建',
        success: (res) => {
          if (res.confirm) {
            setTimeout(() => {
              wx.navigateTo({ url: '/pages/groups/groups' });
            }, 100);
          }
        }
      });
    }
  },

  async loadFullUnlearned(groupId) {
    this.setData({ pageReady: false });
    try {
      // 使用异步方法获取未学习列表
      const all = await storage.getGroupDataAsync(groupId).then(list => 
        list.filter(k => !k.learned)
      );

      let { initialUnlearnedCount } = this.data;

      // 如果是本会话首次加载，则记录初始总数
      if (initialUnlearnedCount === null) {
        initialUnlearnedCount = all.length;
      }
      
      this.setData({ 
        fullUnlearnedList: all,
        initialUnlearnedCount
      });
      this.loadNextBatch();
    } catch (e) {
      console.error('加载未学习列表失败', e);
      this.setData({ 
        pageReady: true,
        isAllLearned: false
      });
      wx.showToast({
        title: '加载数据失败，请重试',
        icon: 'none'
      });
    }
  },

  loadNextBatch() {
    let { fullUnlearnedList, batchSize, initialUnlearnedCount } = this.data;

    // 兼容处理，确保 initialUnlearnedCount 有值
    if (initialUnlearnedCount === null) {
      initialUnlearnedCount = fullUnlearnedList.length;
    }
    
    // 正确计算是否所有知识点都已学习
    const totalUnlearned = fullUnlearnedList.length;
    const isAllLearned = totalUnlearned === 0;
    
    if (isAllLearned) {
      this.setData({ 
        isAllLearned: true, 
        isBatchCompleted: false, 
        unlearnedList: [], 
        current: null, 
        currentIndex: 0, 
        currentBatchIndex: 0, 
        totalBatchCount: 0,
        pageReady: true,
        fullUnlearnedList: [] // 新增，彻底清空未学会列表，防止UI残留
      });
      return;
    }

    // 精确计算总批次数和当前批次索引
    const totalBatchCount = Math.ceil(initialUnlearnedCount / batchSize) || 1;
    const learnedCount = initialUnlearnedCount - fullUnlearnedList.length;
    const batchesLearned = Math.floor(learnedCount / batchSize);
    const currentBatchIndex = batchesLearned + 1;

    const currentBatch = fullUnlearnedList.slice(0, batchSize);

    this.setData({
      unlearnedList: currentBatch,
      current: currentBatch.length ? currentBatch[0] : null,
      currentIndex: 0,
      isBatchCompleted: false,
      isAllLearned: false,
      currentBatchIndex,
      totalBatchCount,
      pageReady: true // 页面已就绪
    });

  },

  markLearned() {
    let { unlearnedList, currentIndex } = this.data;
    if (!unlearnedList.length) return;

    const currentKnowledge = unlearnedList[currentIndex];
    setTimeout(() => {
      currentKnowledge.learned = true;
      storage.saveKnowledge(currentKnowledge);

      if (currentIndex === unlearnedList.length - 1) {
        // 最后一题，进入批次完成状态
        this.setData({ isBatchCompleted: true, current: null });
      } else {
        this.setData({
          currentIndex: currentIndex + 1,
          current: unlearnedList[currentIndex + 1]
        });
      }
    }, 1000);
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (url) {
      wx.previewImage({
        current: url,
        urls: [url]
      });
    }
  },

  // 左右滑动切换卡片
  onTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
  },

  onTouchMove(e) {
    this.touchDeltaX = e.touches[0].clientX - this.touchStartX;
    // 新增：滑动方向提示和位置
    const threshold = 30;
    const clientX = e.touches[0].clientX;
    const clientY = e.touches[0].clientY;
    if (this.touchDeltaX <= -threshold) {
      updateSwipeHint.call(this, '左滑表示已学会', clientX, clientY);
    } else if (this.touchDeltaX >= threshold) {
      updateSwipeHint.call(this, '右滑表示删除', clientX, clientY);
    } else {
      updateSwipeHint.call(this, '', clientX, clientY);
    }
  },

  onTouchEnd(e) {
    const threshold = 60;
    if (this.touchDeltaX <= -threshold) {
      // 左滑，已学会
      this.markLearned();
    } else if (this.touchDeltaX >= threshold) {
      // 右滑，删除
      this.deleteCurrentKnowledge();
    }
    this.touchStartX = 0;
    this.touchDeltaX = 0;
    if (swipeHintThrottleTimer) {
      clearTimeout(swipeHintThrottleTimer);
      swipeHintThrottleTimer = null;
    }
    this.setData({
      swipeHint: '',
      swipeHintX: null,
      swipeHintY: null
    });
    lastSwipeHint = '';
    lastSwipeHintX = null;
    lastSwipeHintY = null;
  },

  // 永久删除当前知识点
  deleteCurrentKnowledge() {
    let { current, groupId } = this.data;
    if (!current) return;

    wx.showModal({
      title: '删除确认',
      content: `确定要永久删除"${current.question}"，不再复习吗？此操作不可撤销。`,
      success: async (res) => {
        if (res.confirm) {
          await storage.removeKnowledge(groupId, current.id);
          // 重新从 storage 加载数据，这是确保页面状态完全同步的最安全方法
          this.loadFullUnlearned(groupId);
        }
      }
    });
  },

  // 新增：用于"下一批"按钮，强制刷新未学会列表
  loadFullUnlearnedHandler() {
    const { groupId } = this.data;
    if (groupId) {
      this.loadFullUnlearned(groupId);
    }
  },

  async toReviewPage() {
    // 跳转前主动刷新今日复习批次
    await storage.refreshAllReviewLists();
    wx.navigateTo({ url: `/pages/review/review?groupId=${this.data.groupId}` });
  },

  onGestureGuideTouchStart(e) {
    // 阻止事件冒泡，防止传递到下层卡片
    if (e.stopPropagation) e.stopPropagation();
    this.setData({ gestureGuideTouchStartX: e.touches[0].clientX });
  },

  onGestureGuideTouchEnd(e) {
    // 阻止事件冒泡，防止传递到下层卡片
    if (e.stopPropagation) e.stopPropagation();
    if (!this.data.gestureGuideActive) return;
    const deltaX = e.changedTouches[0].clientX - this.data.gestureGuideTouchStartX;
    if (deltaX <= -60) {
      // 左滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideLearnGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向左滑动，表示已学会该知识点，将跳转至下一个知识点',
        showCancel: true,
        success: (res) => {
          if (res.confirm) {
            this.markLearned();
          }
        }
      });
    } else if (deltaX >= 60) {
      // 右滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideLearnGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向右滑动，表示不需要再复习该知识点，将删除',
        showCancel: true,
        success: (res) => {
          if (res.confirm) {
            this.deleteCurrentKnowledge();
          }
        }
      });
    }
  }
});

// 注册wxml过滤器
if (typeof wx !== 'undefined' && wx.canIUse && wx.canIUse('nextTick')) {
  wx.nextTick(() => {
    if (typeof getApp === 'function' && getApp().globalData) {
      getApp().globalData.fromNow = fromNow;
    }
  });
}
