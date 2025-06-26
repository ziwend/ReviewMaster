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

let refreshTimer = null;

Page({
  data: {
    groups: [],
    groupIndex: 0,
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
    initialUnlearnedCount: null // 用于精确计算批次
  },

  onLoad(options) {
    let { groupId } = options;
    const groups = getApp().globalData.groups;
    if (!groupId && groups && groups.length > 0) {
      groupId = groups[0].id;
    }
    const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({ title: currentGroup.name });
    }
    const hideGuide = wx.getStorageSync('hideLearnGestureGuide');
    this.setData({ 
      showGestureGuide: !hideGuide, 
      gestureGuideActive: !hideGuide,
      initialUnlearnedCount: null // 每次加载页面重置，开始新的学习会话
    });
  },

  onShow: async function() {
    this.setData({ pageReady: false }); // 页面加载前，设置为未就绪
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const settings = storage.getSettings();
      this.setData({ batchSize: settings.batchSize || 20 });
      await storage.refreshAllReviewListsAsync && storage.refreshAllReviewListsAsync();
      this.refreshGroupsAndData();
    } catch (e) {
      console.error('首页数据刷新失败', e);
    } finally {
      wx.hideLoading();
    }
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      try {
        await storage.refreshAllReviewListsAsync && storage.refreshAllReviewListsAsync();
        this.refreshGroupsAndData();
      } catch (e) {
        console.error('定时刷新失败', e);
      }
    }, 300000);
  },

  onHide() {
    if (refreshTimer) clearInterval(refreshTimer);
  },

  onUnload() {
    if (refreshTimer) clearInterval(refreshTimer);
  },

  refreshGroupsAndData() {
    const groups = getApp().globalData.groups;
    let groupIndex = 0;
    const groupsWithStats = groups.map(g => ({
      ...g,
      displayName: `${g.name}（${g.dueCount || 0}待复习，${g.lastReviewTime ? fromNow(g.lastReviewTime)+'复习' : '未复习'}）`
    }));
    if (groupIndex >= groupsWithStats.length) {
      groupIndex = Math.max(0, groupsWithStats.length - 1);
    }
    this.setData({ groups: groupsWithStats, groupIndex });
    if (groupsWithStats.length > 0) {
      this.loadFullUnlearned(groupsWithStats[groupIndex].id);
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

  loadFullUnlearned(groupId) {
    const all = storage.getUnlearnedKnowledge(groupId);
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
  },

  loadNextBatch() {
    let { fullUnlearnedList, batchSize, initialUnlearnedCount } = this.data;

    // 兼容处理，确保 initialUnlearnedCount 有值
    if (initialUnlearnedCount === null) {
      initialUnlearnedCount = fullUnlearnedList.length;
    }
    
    if (!fullUnlearnedList.length) {
      this.setData({ 
        isAllLearned: true, 
        isBatchCompleted: false, 
        unlearnedList: [], 
        current: null, 
        currentIndex: 0, 
        currentBatchIndex: 0, 
        totalBatchCount: 0,
        pageReady: true // 页面已就绪
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
    wx.showToast({
      title: `${currentKnowledge.question} 已学会`,
      icon: 'success',
      duration: 1000
    });
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
  },

  // 永久删除当前知识点
  deleteCurrentKnowledge() {
    let { current, groups, groupIndex } = this.data;
    if (!current) return;

    wx.showModal({
      title: '删除确认',
      content: `确定要永久删除"${current.question}"吗？此操作不可撤销。`,
      success: async (res) => {
        if (res.confirm) {
          await storage.removeKnowledge(groups[groupIndex].id, current.id);
          
          // 重新从 storage 加载数据，这是确保页面状态完全同步的最安全方法
          // 这可以根除因手动操作 data 而可能引入的各种不一致问题
          this.loadFullUnlearned(groups[groupIndex].id);
          
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 跳转到分组管理
  toGroups() {
    wx.navigateTo({ url: '/pages/groups/groups' });
  },

  toReviewPage() {
    const { groups, groupIndex } = this.data;
    if (!groups.length) {
      wx.showToast({ title: '请先新建分组', icon: 'none' });
      return;
    }
    const id = groups[groupIndex].id;
    wx.navigateTo({ url: `/pages/review/review?groupId=${id}` });
  },

  onGestureGuideTouchStart(e) {
    this.setData({ gestureGuideTouchStartX: e.touches[0].clientX });
  },

  onGestureGuideTouchEnd(e) {
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
        success: () => { this.markLearned(); }
      });
    } else if (deltaX >= 60) {
      // 右滑
      this.setData({ showGestureGuide: false, gestureGuideActive: false });
      wx.setStorageSync('hideLearnGestureGuide', true);
      wx.showModal({
        title: '提示',
        content: '您向右滑动，表示不需要学习该知识点，将直接删除',
        showCancel: false,
        success: () => { this.deleteCurrentKnowledge(); }
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
