const storage = require('../../utils/storage');

Page({
  data: {
    settings: {}
  },

  onLoad: function (options) {
    this.loadSettings();
  },

  loadSettings() {
    const settings = storage.getSettings();
    this.setData({
      settings: settings
    });
  },

  handleInputChange(e) {
    const { key } = e.currentTarget.dataset;
    let value = e.detail.value;

    if (value === '') {
        // 允许用户临时清空输入框，但不保存空值
        return;
    }

    value = Number(value);

    // 输入校验
    if (key === 'batchSize' && (value < 1 || value > 100)) {
        wx.showToast({ title: '批次大小需在1-100之间', icon: 'none' });
        return;
    }
    if ((key === 'delayRemember' || key === 'delayForget') && (value < 1 || value > 300)) {
        wx.showToast({ title: '延迟需在1-300秒之间', icon: 'none' });
        return;
    }

    this.setData({
      [`settings.${key}`]: value
    });
  },

  handleSave() {
    storage.saveSettings(this.data.settings);
    wx.showToast({
      title: '保存成功',
      icon: 'success'
    });
    setTimeout(() => {
      wx.navigateBack();
    }, 1000);
  },

  handleRestore() {
    const defaultSettings = storage.getDefaultSettings();
    storage.saveSettings(defaultSettings);
    this.setData({
      settings: defaultSettings
    });
    wx.showToast({
      title: '已恢复默认设置',
      icon: 'success'
    });
  }
}); 