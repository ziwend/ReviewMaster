import * as echarts from '../../ec-canvas/echarts';
const storage = require('../../utils/storage');

Page({
  data: {
    ec: {
      lazyLoad: true
    },
    id: null,
    history: [],
    addTime: null,
    chartInited: false,
    historyPage: 1,
    historyPageSize: 50,
    historyHasMore: true
  },
  onLoad(options) {
    const id = Number(options.id);
    this.setData({ id });
    this.loadHistory(id);
  },
  onReady() {
    // 如果数据已加载但图表未初始化，尝试初始化一次
    if (this.data.history.length && !this.data.chartInited) {
      this.initChartFromData();
    }
  },
  async loadHistory(id) {
    // 辅助格式化函数
    function formatTime(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleString();
    }
    function formatInterval(interval) {
      if (interval < 1 / 24) return `${Math.round(interval * 24 * 60)}分钟`;
      if (interval < 1) return `${Math.round(interval * 24)}小时`;
      return `${interval}天`;
    }
    function formatRealGap(idx, time, arr, addTime) {
      let realGap = '';
      if (idx === 0 && addTime) {
        const gapMs = time - addTime;
        if (gapMs < 3600 * 1000) realGap = `（上次：${Math.round(gapMs / 60000)}分钟前）`;
        else if (gapMs < 24 * 3600 * 1000) realGap = `（上次：${Math.round(gapMs / 3600000)}小时前）`;
        else realGap = `（上次：${Math.round(gapMs / 86400000)}天前）`;
      } else if (idx > 0) {
        const gapMs = time - arr[idx - 1].time;
        if (gapMs < 3600 * 1000) realGap = `（上次：${Math.round(gapMs / 60000)}分钟前）`;
        else if (gapMs < 24 * 3600 * 1000) realGap = `（上次：${Math.round(gapMs / 3600000)}小时前）`;
        else realGap = `（上次：${Math.round(gapMs / 86400000)}天前）`;
      }
      return realGap;
    }
    function formatEfactor(efactor) {
      return typeof efactor === 'number' ? efactor.toFixed(2) : efactor;
    }

    let knowledge = storage.getKnowledgeByIdCached(id);
    if (!knowledge || !knowledge.history || knowledge.history.length === 0) {
      wx.showToast({ title: '无复习记录', icon: 'none' });
      return;
    }
    // 预处理历史记录，生成美化字段
    const page = this.data.historyPage || 1;
    const pageSize = this.data.historyPageSize || 50;
    const total = knowledge.history.length;
    const hasMore = (page * pageSize) < total;
    const pageHistory = knowledge.history.slice((page - 1) * pageSize, page * pageSize);
    const history = pageHistory.map((h, idx, arr) => ({
      ...h,
      displayTime: formatTime(h.time),
      displayScore: h.quality,
      displayInterval: formatInterval(h.interval),
      displayRealGap: formatRealGap(idx, h.time, arr, knowledge.addTime),
      displayEfactor: formatEfactor(h.efactor)
    }));
    this.setData({ history, addTime: knowledge.addTime, historyHasMore: hasMore, question: knowledge.question }, () => {
      this.initChart({ ...knowledge, history: pageHistory });
    });
  },
  initChart(knowledge) {
    if (!knowledge || !knowledge.history || !knowledge.history.length) return;
    this.selectComponent('#historyChart').init((canvas, width, height, dpr) => {
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      const xData = knowledge.history.map((h, idx) => `第${idx + 1}次`);
      const efactorData = knowledge.history.map(h => Number(h.efactor && h.efactor.toFixed ? h.efactor.toFixed(2) : h.efactor));
      const scoreData = knowledge.history.map(h => h.quality);
      // 实际间隔
      const gapData = knowledge.history.map((h, idx, arr) => {
        let gap = 0;
        if (idx === 0 && knowledge.addTime) {
          gap = (h.time - knowledge.addTime) / 60000; // 分钟
        } else if (idx > 0) {
          gap = (h.time - arr[idx - 1].time) / 60000; // 分钟
        }
        return Number(gap.toFixed(1));
      });
      const option = {
        title: { text: '复习记录曲线', left: 'center', top: 10 },
        tooltip: { trigger: 'axis' },
        legend: { data: ['efactor', '分数', '实际间隔(分钟)'], top: 40 },
        grid: { left: 30, right: 30, bottom: 40, top: 80 },
        xAxis: { type: 'category', data: xData },
        yAxis: [
          { type: 'value', name: 'efactor/分数', min: 0, max: 5 },
          { type: 'value', name: '实际间隔(分钟)', min: 0 }
        ],
        series: [
          { name: 'efactor', type: 'line', data: efactorData, yAxisIndex: 0, smooth: true },
          { name: '分数', type: 'line', data: scoreData, yAxisIndex: 0, smooth: true },
          { name: '实际间隔(分钟)', type: 'bar', data: gapData, yAxisIndex: 1, barWidth: 18 }
        ]
      };
      chart.setOption(option);
      this.setData({ chartInited: true });
      return chart;
    });
  },
  initChartFromData() {
    if (this.data.history.length) {
      // 取history的原始knowledge结构
      const knowledge = { history: this.data.history, addTime: this.data.addTime };
      this.initChart(knowledge);
    }
  },
  // 新增：加载更多历史
  loadMoreHistory() {
    if (!this.data.historyHasMore) return;
    this.setData({ historyPage: this.data.historyPage + 1 }, () => {
      this.loadHistory(this.data.id);
    });
  },
  goBack() {
    wx.navigateBack();
  }
});