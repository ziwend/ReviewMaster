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
    try {
      const res = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['txt'],
      });
      const path = res.tempFiles[0].path;
      await this.readFileAndImport(path);
    } catch (err) {
      if (err.errMsg && err.errMsg.includes('cancel')) {
        return;
      }
      console.error("选择文件失败", err);
      wx.showToast({
        title: '选择文件失败',
        icon: 'none'
      });
    }
  },

  async readFileAndImport(path) {
    const fs = wx.getFileSystemManager();
    try {
      const content = await new Promise((resolve, reject) => {
        fs.readFile({
          filePath: path,
          encoding: 'utf-8',
          success: res => resolve(res.data),
          fail: reject
        });
      });
      this.setData({ content });
      wx.showToast({
        title: '文件内容已加载',
        icon: 'none'
      });
    } catch (e) {
      console.error("读取文件失败", e);
      wx.showToast({
        title: '读取文件失败',
        icon: 'none'
      });
    }
  },

  startImportFromTextarea() {
    console.log("import执行startImportFromTextarea");
    this.startImport(this.data.content);
  },

  async startImport(fullContent) {

    if (this.data.importing) {
      wx.showToast({ title: '正在导入中...', icon: 'none' });
      return;
    }

    if (!this.data.selectedGroupId) {
      wx.showToast({
        title: '请先选择或新建一个分组',
        icon: 'none'
      });
      return;
    }
    const lines = fullContent.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
      wx.showToast({
        title: '内容不能为空',
        icon: 'none'
      });
      return;
    }

    this.setData({
      importing: true,
      showProgressBar: true,
      progress: 0,
    });
    
    await this.processInBatches(lines, this.data.selectedGroupId);
  },

  async processInBatches(lines, groupId) {
    const BATCH_SIZE = 100;
    let currentIndex = 0;
    const totalLines = lines.length;
    let totalAdded = 0;

    // 引入 groups 页的缓存对象
    let groupKnowledgeCountMap;
    try {
      // 兼容热重载和不同页面作用域
      groupKnowledgeCountMap = getApp().globalData.groupKnowledgeCountMap;
    } catch (e) {
      groupKnowledgeCountMap = {};
    }

    while (currentIndex < totalLines) {
      const batchLines = lines.slice(currentIndex, currentIndex + BATCH_SIZE);
      const knowledgeBatch = batchLines.map(line => {
        const parts = line.split(/\t|\|\|\|/);
        const question = parts[0] ? parts[0].trim() : '';
        const answer = parts.length > 1 ? parts.slice(1).join(' ').trim() : '';
        return {
          question,
          answer,
          groupId: groupId,
          addTime: Date.now(),
          nextReviewTime: Date.now(),
          reviewCount: 0,
          history: [],
          status: 'pending'
        };
      }).filter(item => item.question);

      if (knowledgeBatch.length > 0) {
        await storage.addKnowledgeBatchToGroup(groupId, knowledgeBatch);
        // 动态维护缓存
        if (groupKnowledgeCountMap) {
          groupKnowledgeCountMap[groupId] = (groupKnowledgeCountMap[groupId] || 0) + knowledgeBatch.length;
        }
        totalAdded += knowledgeBatch.length;
      }

      currentIndex += BATCH_SIZE;
      const progress = Math.min(100, Math.round((currentIndex / totalLines) * 100));

      this.setData({ progress });
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    this.setData({
      importing: false,
      showProgressBar: false,
      content: ''
    });

    await new Promise(resolve => {
      wx.showModal({
        title: '导入完成',
        content: `成功导入 ${totalLines} 个知识点。`,
        showCancel: false,
        success: () => {
          wx.navigateTo({
            url: `/pages/review/review?groupId=${groupId}`
          });
          resolve();
        }
      });
    });
  }
})