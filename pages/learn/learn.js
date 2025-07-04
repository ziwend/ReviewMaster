// learn.js
const storage = require('../../utils/storage');
const {
    createSwipeHandler
} = require('../../utils/swipeHint')

// 在滑动处理函数（如onTouchMove）中，替换原有setData逻辑：
const aSwipeHandler = createSwipeHandler('a');

Page({
    data: {
        unlearnedList: [], // 当前批次未学会id
        currentIndex: 0,
        current: null,
        pageReady: false, // 页面是否准备好渲染
        isBatchCompleted: false, // 当前批次已学完
        isAllLearned: false, // 所有未学会已学完
        showGestureGuide: true,
        gestureGuideActive: true,
        gestureGuideTouchStartX: 0,
        currentBatchIndex: 0,
        totalBatchCount: 0,
        swipeHint: '', // 新增：滑动提示文本
        swipeHintX: null, // 新增：滑动提示横坐标
        swipeHintY: null, // 新增：滑动提示纵坐标
        groupId: null, // 关键：写入data，便于后续分组定位
        page: 1, // 当前分页页码
        hasMore: true, // 是否还有更多
        cardTranslateX: 0, // 新增：卡片横向位移
        cardTransition: '', // 新增：卡片过渡效果
        learnedCount: 0, // 新增：已学会数量
        cardClass: '', // 新增：卡片类名
        rotate: 0
    },

    settings: {}, // 存储设置

    onLoad: function (options) {
        const {
            groupId
        } = options;
        const groups = getApp().globalData.groups;

        const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
        if (currentGroup && currentGroup.name) {
            wx.setNavigationBarTitle({
                title: currentGroup.name
            });
        }
        const hideGuide = wx.getStorageSync('hideLearnGestureGuide');
        this.settings = storage.getSettings();
        this.setData({
            groupId,
            showGestureGuide: !hideGuide,
            gestureGuideActive: !hideGuide,
        }, () => {
            this.loadNextBatch();
          });
    },

    onShow: function () {
        console.log("learn on show");
    },

    loadNextBatch() {
        const {
            groupId,
            page
        } = this.data;
        const pageSize = this.settings.batchSize || 20;
        const unlearnedList = storage.getUnlearnedPaged(groupId, page, pageSize);
        const unlearnedCount = storage.getUnlearnedCount(groupId);
        const hasMore = (page * pageSize) < unlearnedCount;
        const current = unlearnedList.length ? {
            ...unlearnedList[0]
        } : null;
        const totalBatchCount = Math.ceil(unlearnedCount / pageSize);
        const currentBatchIndex = page;
        this.setData({
            unlearnedList,
            current,
            currentIndex: 0,
            isBatchCompleted: false,
            isAllLearned: unlearnedCount === 0,
            unlearnedCount,
            pageReady: true,
            hasMore,
            currentBatchIndex,
            totalBatchCount
        });
    },

    // 新增：加载下一页
    loadMore() {
        if (!this.data.hasMore) return;
        this.setData({
            page: this.data.page + 1
        }, () => {
            this.loadNextBatch();
        });
    },

    // 新增：重置分页
    resetPaging() {
        this.setData({
            page: 1
        }, () => {
            this.loadNextBatch();
        });
    },

    markLearned() {
        // 要先获取current，因为nextOne中会修改
        const currentKnowledge = this.data.unlearnedList[this.data.currentIndex];        

        // 异步保存，UI先行
        storage.saveKnowledge({
            ...currentKnowledge,
            learned: true,
            status: 'reviewing',
            repetition: 0,
            efactor: this.settings.efactor || 2.5,
            nextReviewTime: Date.now() + 5 * 60 * 1000,
        });  
    },

    nextOne() {
        let {
            unlearnedList,
            currentIndex
        } = this.data;

        if (currentIndex < unlearnedList.length - 1) {
            // 批次内还有下一题
            this.setData({
                currentIndex: currentIndex + 1,
                current: unlearnedList[currentIndex + 1],
                cardTranslateX: 0, // 重置卡片位置
                cardTransition: '', // 清除过渡效果
                unlearnedCount: this.data.unlearnedCount - 1 //不管是删除，稍后学都减去一
            }, () => {
                this.touchStartX = 0; // 重置触摸起始位置
                this.touchDeltaX = 0; // 重置滑动距离
            });
        } else {
            this.handleBatchCompleted();
        }
    },
    // 统一批次完成处理
    handleBatchCompleted() {        
        this.setData({
            dueCount: storage.getDueCount(this.data.groupId),
            isAllLearned: this.data.unlearnedCount - 1 === 0,
            isBatchCompleted: true,
            current: null,
            unlearnedList: [],
        });
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
        const threshold = 60;
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        let cardClass = '';
        let hint = '';
        let rotate = 0;
        if (this.touchDeltaX <= -threshold) {
            cardClass = 'swipe-left';
            hint = '左滑表示已学会';
            rotate = -5;
        } else if (this.touchDeltaX >= threshold) {
            cardClass = 'swipe-right';
            hint = '右滑表示稍后学';
            rotate = 5;
        }
        // 卡片跟随手指移动
      this.setData({
        cardTranslateX: this.touchDeltaX,
        cardTransition: '',
        cardClass: cardClass,
        cardRotate: rotate
      });
        aSwipeHandler.updateHint.call(this, hint, clientX, clientY);
    },

    onTouchEnd(e) {
        const threshold = 60;
        let animateOut = false;
        let direction = 0;
        if (this.touchDeltaX <= -threshold) {
            // 左滑，已学会
            animateOut = true;
            direction = -1;
        } else if (this.touchDeltaX >= threshold) {
            // 右滑，稍后学
            animateOut = true;
            direction = 1;
        }
        if (animateOut) {
            // 先执行动画再更新数据
            this.setData({
                cardTranslateX: direction * 750,
                cardTransition: 'transform 0.3s cubic-bezier(.4,2,.6,1)',
                cardClass: '',
                cardRotate: 0
            }, () => {
                setTimeout(() => {
                    if (direction === -1) this.markLearned();
                    else if (direction === 1) console.log("learn swipe to right");                    
                    this.nextOne();                    
                }, 300);
            });

            // 重置触摸状态
            this.touchStartX = 0;
            this.touchDeltaX = 0;
        } else {
            this.setData({
                cardTranslateX: 0,
                cardTransition: 'transform 0.2s',
                cardClass: '',
                cardRotate: 0
            });
        }
        aSwipeHandler.reset.call(this);
    },

    // 永久删除当前知识点
    deleteCurrentKnowledge() {
        let {
            current,
            groupId
        } = this.data;
        if (!current) return;

        wx.showModal({
            title: '删除确认',
            content: `确定要永久删除"${current.question}"，不再复习吗？此操作不可撤销。`,
            success: async (res) => {
                if (res.confirm) {
                    storage.removeKnowledge(groupId, current.id);
                    // 重新从 storage 加载数据，这是确保页面状态完全同步的最安全方法
                    // this.loadNextBatch();
                    this.nextOne(); // 删除一条后跳转下一条
                }
            }
        });
    },

    toReviewPage() {
        // 跳转前主动刷新今日复习批次
        storage.refreshAllReviewLists();
        wx.navigateTo({
            url: `/pages/review/review?groupId=${this.data.groupId}`
        });
    },

    onGestureGuideTouchStart(e) {
        // 阻止事件冒泡，防止传递到下层卡片
        if (e.stopPropagation) e.stopPropagation();
        this.setData({
            gestureGuideTouchStartX: e.touches[0].clientX
        });
    },

    onGestureGuideTouchEnd(e) {
        // 阻止事件冒泡，防止传递到下层卡片
        if (e.stopPropagation) e.stopPropagation();
        if (!this.data.gestureGuideActive) return;
        const deltaX = e.changedTouches[0].clientX - this.data.gestureGuideTouchStartX;
        if (deltaX <= -60) {
            // 左滑
            this.setData({
                showGestureGuide: false,
                gestureGuideActive: false
            });
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
            this.setData({
                showGestureGuide: false,
                gestureGuideActive: false
            });
            wx.setStorageSync('hideLearnGestureGuide', true);
            wx.showModal({
                title: '提示',
                content: '您向右滑动，表示稍后学习该知识点',
                showCancel: true,
                success: (res) => {
                    if (res.confirm) {
                        this.nextOne();
                    }
                }
            });
        }
    }
});