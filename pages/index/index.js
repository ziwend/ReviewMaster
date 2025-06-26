// index.js
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
    unlearnedList: [],
    currentIndex: 0,
    current: null,
    pageReady: false, // 页面是否准备好渲染
    receivedGroupId: null
  },

  onLoad(options) {
    if (options && options.groupId) {
      this.setData({ receivedGroupId: options.groupId });
    }
  },
async onShow() {
  // 显示加载状态
  wx.showLoading({ title: '加载中', mask: true });
  
  try {
    // 使用异步刷新
    await storage.refreshAllReviewListsAsync();
    this.refreshGroupsAndData();
  } catch (e) {
    console.error('首页数据刷新失败', e);
  } finally {
    wx.hideLoading();
  }
  
  // 调整定时器为5分钟
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    try {
      await storage.refreshAllReviewListsAsync();
      this.refreshGroupsAndData();
    } catch (e) {
      console.error('定时刷新失败', e);
    }
  }, 300000); // 5分钟
},
  onHide() {
    if (refreshTimer) clearInterval(refreshTimer);
  },
  onUnload() {
    if (refreshTimer) clearInterval(refreshTimer);
  },
  refreshGroupsAndData() {
    const groups = getApp().globalData.groups;
    let groupId = this.data.receivedGroupId;
    let groupIndex = 0;
    if (groupId) {
      groupIndex = groups.findIndex(g => g.id == groupId);
      if (groupIndex === -1) groupIndex = 0;
      this.setData({ receivedGroupId: null });
    } else {
      groupIndex = this.data.groupIndex || 0;
      if (groupIndex >= groups.length) groupIndex = Math.max(0, groups.length - 1);
    }
    const groupsWithStats = groups.map(g => ({
      ...g,
      displayName: `${g.name}（${g.dueCount || 0}待复习，${g.lastReviewTime ? fromNow(g.lastReviewTime)+'复习' : '未复习'}）`
    }));
    if (groupIndex >= groupsWithStats.length) {
      groupIndex = Math.max(0, groupsWithStats.length - 1);
    }
    this.setData({ groups: groupsWithStats, groupIndex });
    if (groupsWithStats.length > 0) {
      this.loadUnlearned(groupsWithStats[groupIndex].id);
    } else {
      this.setData({
        unlearnedList: [],
        current: null,
        currentIndex: 0
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
  // 分组选择
  bindGroupChange(e) {
    const groupIndex = e.detail.value;
    const groupId = this.data.groups[groupIndex].id;
    this.setData({ groupIndex });
    this.loadUnlearned(groupId);
  },

  // 加载未学习知识点
  loadUnlearned(groupId) {
    // 只存id列表
    const unlearnedArr = storage.getUnlearnedKnowledge(groupId);
    const unlearnedList = unlearnedArr.map(k => k.id);
    const current = unlearnedList.length ? storage.getKnowledgeById(unlearnedList[0]) : null;
    this.setData({ unlearnedList, currentIndex: 0, current });
  },

  // 标记为已学会并切换到下一个
  markLearned() {
    let { unlearnedList, currentIndex, groups, groupIndex } = this.data;
    if (!unlearnedList.length) return;
    const currentId = unlearnedList[currentIndex];
    const current = storage.getKnowledgeById(currentId);
    current.learned = true;
    storage.saveKnowledge(current);
    unlearnedList.splice(currentIndex, 1);
    let nextIndex = currentIndex;
    if (nextIndex >= unlearnedList.length) nextIndex = 0;
    const nextCurrent = unlearnedList.length ? storage.getKnowledgeById(unlearnedList[nextIndex]) : null;
    this.setData({
      unlearnedList,
      currentIndex: nextIndex,
      current: nextCurrent
    });
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
    let { currentIndex, unlearnedList } = this.data;
    if (this.touchDeltaX <= -threshold && currentIndex < unlearnedList.length - 1) {
      // 左滑，下一题
      const nextCurrent = storage.getKnowledgeById(unlearnedList[currentIndex + 1]);
      this.setData({
        currentIndex: currentIndex + 1,
        current: nextCurrent
      });
    } else if (this.touchDeltaX >= threshold && currentIndex > 0) {
      // 右滑，上一题
      const prevCurrent = storage.getKnowledgeById(unlearnedList[currentIndex - 1]);
      this.setData({
        currentIndex: currentIndex - 1,
        current: prevCurrent
      });
    }
    this.touchStartX = 0;
    this.touchDeltaX = 0;
  },

  // 永久删除当前知识点
  deleteCurrentKnowledge() {
    let { unlearnedList, currentIndex, groups, groupIndex } = this.data;
    if (!unlearnedList.length) return;
    const current = unlearnedList[currentIndex];
    wx.showModal({
      title: '删除确认',
      content: `确定要永久删除"${current.question}"吗？此操作不可撤销。`,
      success: (res) => {
        if (res.confirm) {
          storage.removeKnowledge(groups[groupIndex].id, current.id);
          unlearnedList.splice(currentIndex, 1);
          let nextIndex = currentIndex;
          if (nextIndex >= unlearnedList.length) nextIndex = 0;
          this.setData({
            unlearnedList,
            currentIndex: nextIndex,
            current: unlearnedList[nextIndex] || null
          });
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  // 跳转到分组管理
  toGroups() {
    wx.navigateTo({ url: '/pages/groups/groups' });
  },

  toReviewPage: function () {
    const { groups, groupIndex } = this.data;
    if (!groups.length) {
      wx.showToast({ title: '请先新建分组', icon: 'none' });
      return;
    }
    const id = groups[groupIndex].id;
    wx.navigateTo({
      url: `/pages/review/review?groupId=${id}`
    });
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
