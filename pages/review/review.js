const storage = require('../../utils/storage')

const BATCH_SIZE = 20; // 每天最大复习数

// 新增：反馈分数映射（可根据实际UI调整）
const FEEDBACK_SCORE = {
  'remember': 5, // 记住了
  'vague': 3,   // 模糊
  'forget': 1   // 没记住
};

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
    touchDeltaX: 0,
    showDeleteButton: false
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
    
    // 设置导航栏标题为分组名
    if (currentGroup && currentGroup.name) {
      wx.setNavigationBarTitle({ title: currentGroup.name });
    }

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

  // 统一处理复习反馈
  handleReviewFeedback(type) {
    let quality = FEEDBACK_SCORE[type] || 0;
    let { current } = this.data;
    if (!current) return;
    // 判断是否显示删除按钮
    let showDeleteButton = (type === 'remember');
    this.setData({ showDeleteButton, showResult: true });
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
    // 设置自动翻页定时器
    const delay = quality >= 3 ? 10000 : 30000;
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
        showResult: false,
        showDeleteButton: false
      });
    } else {
      this.setData({
        current: null,
        currentIndex: -1,
        reviewList: [],
        isBatchCompleted: true,
        showResult: false,
        showDeleteButton: false
      });
    }
  },

  prevOne() {
    let { currentIndex, reviewList } = this.data;
    if (currentIndex > 0) {
      currentIndex--;
      let current = reviewList[currentIndex];
      
      let showResult = false;
      let showDeleteButton = false;

      if (current.history && current.history.length > 0) {
        const lastAction = current.history[current.history.length - 1];
        // 假设history里存有quality
        if (lastAction && lastAction.quality) {
          showResult = true;
          showDeleteButton = lastAction.quality >= 5;
        }
      }

      if (current) current.lastRememberAgo = getLastRememberAgo(current);
      
      this.setData({
        currentIndex,
        current,
        showResult,
        showDeleteButton
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
      // 左滑，下一题
      this.nextOne();
    } else if (this.touchDeltaX >= threshold) {
      // 右滑，上一题
      this.prevOne();
    }
    // 重置
    this.touchStartX = 0;
    this.touchDeltaX = 0;
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
