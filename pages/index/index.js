// index.js
const storage = require('../../utils/storage');

Page({
  data: {
    groups: [],
    groupIndex: 0,
    unlearnedList: [],
    currentIndex: 0,
    current: null,
    pageReady: false // 页面是否准备好渲染
  },

  onLoad() {
    // onLoad中可以不做事，或者只做一次性的初始化
  },
  onShow() {
    const groups = storage.getAllGroups();
    let groupIndex = this.data.groupIndex || 0;
    
    if (groupIndex >= groups.length) {
      groupIndex = Math.max(0, groups.length - 1);
    }

    this.setData({ groups, groupIndex });

    if (groups.length > 0) {
      this.loadUnlearned(groups[groupIndex].id);
    } else {
      this.setData({
        unlearnedList: [],
        current: null,
        currentIndex: 0
      });
      wx.showModal({
        title: '提示',
        content: '当前没有分组，请先新建分组！',
        showCancel: false,
        confirmText: '去新建',
        success: (res) => {
          if (res.confirm) {
            // 延迟跳转，给弹窗关闭留出时间
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
    const unlearnedList = storage.getUnlearnedKnowledge(groupId);
    this.setData({ unlearnedList, currentIndex: 0, current: unlearnedList[0] || null });
  },

  // 标记为已学会并切换到下一个
  markLearned() {
    let { unlearnedList, currentIndex, groups, groupIndex } = this.data;
    if (!unlearnedList.length) return;
    const current = unlearnedList[currentIndex];
    current.learned = true;
    storage.saveKnowledge(current);
    unlearnedList.splice(currentIndex, 1);
    let nextIndex = currentIndex;
    if (nextIndex >= unlearnedList.length) nextIndex = 0;
    this.setData({
      unlearnedList,
      currentIndex: nextIndex,
      current: unlearnedList[nextIndex] || null
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
      this.setData({
        currentIndex: currentIndex + 1,
        current: unlearnedList[currentIndex + 1]
      });
    } else if (this.touchDeltaX >= threshold && currentIndex > 0) {
      // 右滑，上一题
      this.setData({
        currentIndex: currentIndex - 1,
        current: unlearnedList[currentIndex - 1]
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
    if (!groups.length) return;
    const id = groups[groupIndex].id;
    wx.navigateTo({
      url: `/pages/review/review?groupId=${id}`
    });
  }
});
