const storage = require('../../utils/storage.js')

Page({
  data: {
    groups: [],
    groupIndex: 0,
    selectedGroupId: null,
    content: '',
    showProgressBar: false,
    progress: 0,
    importing: false,
  },
  onLoad: async function (options) {
    await this.loadGroups();
    // 带有 options.groupId 表示从"添加分组"跳转而来，需要定位到该分组
    if (options.groupId) {
      this.selectGroup(options.groupId);
    }
  },
  onShow: function () {
    // onShow 时不带参数，正常加载或刷新
    if (this.data.groups.length === 0) { // 避免每次都刷新，只在初次或无数据时加载
      this.loadGroups();
    }
  },
  loadGroups: async function() {
    const groups = await storage.getAllGroups();
    if (groups && groups.length > 0) {
      this.setData({ 
        groups: groups,
        selectedGroupId: groups[0].id, // 默认选中第一个
        groupIndex: 0
      });
    } else {
      this.setData({ groups: [], selectedGroupId: null, groupIndex: 0 });
    }
  },
  selectGroup: function(targetGroupId) {
    const index = this.data.groups.findIndex(g => g.id == targetGroupId);
    if (index !== -1) {
      this.setData({
        groupIndex: index,
        selectedGroupId: this.data.groups[index].id
      });
    }
  },
  bindGroupChange(e) {
    const groupIndex = e.detail.value
    this.setData({
      groupIndex: groupIndex,
      selectedGroupId: this.data.groups[groupIndex].id
    })
  },
  bindContentInput(e) {
    this.setData({
      content: e.detail.value
    })
  },

  async importFromTxt() {
    this.setData({ showProgressBar: true, progress: 0, importing: true });

    // 优先使用 wx.miniapp.chooseFile
    if (typeof wx !== 'undefined' && wx.miniapp && typeof wx.miniapp.chooseFile === 'function') {
      try {
        wx.miniapp.chooseFile({
          count: 1,
          success: (res) => {
            const tempFilePath = res.tempFiles[0].path;
            const fs = wx.getFileSystemManager();
            fs.readFile({
              filePath: tempFilePath,
              encoding: 'utf-8',
              success: (res) => {
                this.handleJsonContent(res.data);
              },
              fail: (e) => {
                wx.showToast({ title: '读取文件失败', icon: 'none' });
                this.setData({ showProgressBar: false, importing: false });
              }
            });
          },
          fail: (err) => {
            wx.showToast({ title: '选择文件失败', icon: 'none' });
            this.setData({ showProgressBar: false, importing: false });
          }
        });
        return;
      } catch (err) {
        wx.showToast({ title: '选择文件失败', icon: 'none' });
        this.setData({ showProgressBar: false, importing: false });
        return;
      }
    }

    // 微信小程序原生环境
    let isMiniProgram = false;
    try {
      const sysInfo = wx.getSystemInfoSync && wx.getSystemInfoSync();
      isMiniProgram = sysInfo && sysInfo.platform && (
        sysInfo.platform === 'devtools' ||
        sysInfo.platform === 'android' ||
        sysInfo.platform === 'ios'
      );
    } catch (e) {
      isMiniProgram = false;
    }

    if (isMiniProgram && wx.chooseMessageFile) {
      try {
        const res = await wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['json'],
        });
        const tempFilePath = res.tempFiles[0].path;
        const fs = wx.getFileSystemManager();
        const content = await new Promise((resolve, reject) => {
          fs.readFile({
            filePath: tempFilePath,
            encoding: 'utf-8',
            success: (res) => resolve(res.data),
            fail: reject,
          });
        });
        this.handleJsonContent(content);
        return;
      } catch (err) {
        wx.showToast({ title: '当前小程序环境不支持导入文件', icon: 'none' });
        this.setData({ showProgressBar: false, importing: false });
        return;
      }
    }

    // 兜底：当前环境不支持导入
    wx.showToast
      ? wx.showToast({ title: '当前环境不支持导入', icon: 'none' })
      : alert('当前环境不支持导入');
    this.setData({ showProgressBar: false, importing: false });
  },

  startImportFromTextarea() {
    this.setData({ showProgressBar: true, progress: 0 });
    this.handleJsonContent(this.data.content);
  },
  
  handleJsonContent(content) {
    try {
      if (!content || !content.trim().startsWith('[')) {
        throw new Error('内容不是有效的JSON数组格式，请以 [ 开头。');
      }

      const parsedList = JSON.parse(content);

      if (!Array.isArray(parsedList)) {
        throw new Error('JSON格式错误，顶层结构必须是一个数组。');
      }
      
      const validItems = parsedList.filter(item => {
        const hasQuestion = item && typeof item.question !== 'undefined';
        const hasAnswer = item && typeof item.answer !== 'undefined';
        if (!hasQuestion || !hasAnswer) {
          console.warn('跳过无效的导入项 (缺少question或answer):', item);
        }
        return hasQuestion && hasAnswer;
      });

      if (validItems.length !== parsedList.length) {
          wx.showToast({
              title: `部分条目无效，已跳过`,
              icon: 'none'
          });
      }

      if (validItems.length > 0) {
        this.setData({ importing: true });

        this.processInBatches(validItems, this.data.groups[this.data.groupIndex].id);
      } else {
        wx.showToast({ title: '没有可导入的有效内容', icon: 'none' });
        this.setData({ importing: false, showProgressBar: false });
      }

    } catch (e) {
      console.error('导入内容解析失败', e);
      wx.showToast({ title: `解析失败: ${e.message}`, icon: 'none', duration: 3000 });
      this.setData({ importing: false, showProgressBar: false });
    }
  },

  async processInBatches(items, groupId) {
    const BATCH_SIZE = 100;
    let currentIndex = 0;
    const totalItems = items.length;
    let totalAdded = 0;

    // 引入 groups 页的缓存对象
    let groupKnowledgeCountMap;
    try {
      // 兼容热重载和不同页面作用域
      groupKnowledgeCountMap = getApp().globalData.groupKnowledgeCountMap;
    } catch (e) {
      groupKnowledgeCountMap = {};
    }

    while (currentIndex < totalItems) {
      const batchItems = items.slice(currentIndex, currentIndex + BATCH_SIZE);
      const knowledgeBatch = batchItems.map(item => {        // 确保item是对象且包含question和answer
        if (typeof item !== 'object' || !item.question || !item.answer) {
          console.warn('跳过无效的导入项:', item);
          return null;
        }
        const newKnowledge = {
          question: item.question,
          answer: item.answer,
          media: item.media || [], // 正确处理media字段
          groupId: groupId,
          addTime: Date.now(),
          nextReviewTime: Date.now() - 1000,
          reviewCount: 0,
          history: [],
          status: 'pending',
          lastInterval: 0
        };

        return newKnowledge;
      }).filter(item => item !== null); // 过滤掉无效项

      if (knowledgeBatch.length > 0) {
        await storage.addKnowledgeBatchToGroup(groupId, knowledgeBatch);
        totalAdded += knowledgeBatch.length;
      }

      currentIndex += BATCH_SIZE;
      const progress = Math.min(100, Math.round((currentIndex / totalItems) * 100));

      this.setData({ progress });
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.setData({
      importing: false,
      showProgressBar: false,
      content: ''
    });

    // 导入完成后，主动生成今日复习批次
    storage.getTodayReviewList(groupId, 20);

    await new Promise(resolve => {
      wx.showModal({
        title: '导入完成',
        content: `成功导入 ${totalAdded} 个知识点。`,
        showCancel: false,
        success: async () => {
          // 跳转前加延迟，确保本地存储和批次写入完成
          // 确保数据写入完成
          await new Promise(r => setTimeout(r, 500));
          wx.navigateTo({
            url: `/pages/learn/learn?groupId=${groupId}&forceRefresh=true`
          });
          // safeGoBackToIndexWithGroupId(groupId);
          resolve();
        }
      });
    });
  },
})

// 安全返回index页面并携带groupId
function safeGoBackToIndexWithGroupId(groupId) {
  const pages = getCurrentPages();
  if (pages.length >= 3) {
    const targetPage = pages[pages.length - 3];
    if (targetPage && targetPage.route && targetPage.route.indexOf('pages/index/index') !== -1) {
      if (targetPage.setData) {
        targetPage.setData({ receivedGroupId: groupId });
      }
      wx.navigateBack({ delta: 2 });
      return;
    }
  }
  wx.reLaunch({ url: `/pages/index/index?groupId=${groupId}` });
}
