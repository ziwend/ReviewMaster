// learn.js
const storage = require('../../utils/storage');
const {
    createSwipeHandler,
    throttle
} = require('../../utils/swipeHint')

// 在滑动处理函数（如onTouchMove）中，替换原有setData逻辑：
const aSwipeHandler = createSwipeHandler('a');

Page({
    data: {
        unlearnedList: [], // 当前批次未学会id
        currentIndex: 0,
        current: null,
        currentGroup: {},
        isBatchCompleted: false, // 当前批次已学完
        isAllLearned: false, // 所有未学会已学完
        totalBatchCount: 0,
        learnedCount: 0, // 新增：已学会数量
        groupId: null, // 关键：写入data，便于后续分组定位
        hasMore: false, // 是否还有更多
        cardTranslateX: 0, // 新增：卡片横向位移
        cardTransition: '', // 新增：卡片过渡效果        
        cardClass: '', // 新增：卡片类名
        cardRotate: 0,
        swipeHint: '', // 新增：滑动提示文本
        swipeHintX: null, // 新增：滑动提示横坐标
        swipeHintY: null, // 新增：滑动提示纵坐标
        showGestureGuide: true,
        gestureGuideActive: true,
        gestureGuideTouchStartX: 0,
    },

    settings: {}, // 存储设置

    onLoad: function (options) {
        const {
            groupId
        } = options;
        const groups = storage.getAllGroups();
        const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
        if (currentGroup && currentGroup.name) {
            wx.setNavigationBarTitle({
                title: currentGroup.name
            });
        }
        const unlearnedCount = currentGroup.unlearnedCount;
        const totalBatchCount = Math.ceil(unlearnedCount / pageSize);

        const hideGuide = storage.perfGetStorageSync('hideLearnGestureGuide');
        this.settings = storage.getSettings();
        const pageSize = this.settings.batchSize || 20;
        
        this.setData({
            groupId,
            currentGroup,
            currentBatchIndex: 1,
            totalBatchCount,
            learnedCount: currentGroup.learnedCount,
            page: 1, // 当前分页页码
            pageSize,            
            showGestureGuide: !hideGuide,
            gestureGuideActive: !hideGuide,
        }, () => {
            this.loadNextBatch();
        });
        this.throttledSetHint = throttle((hint, x, y) => {
            aSwipeHandler.updateHint.call(this, hint, x, y);
        }, 50);
    },

    onShow: function () {
        this.loadGroups();
        console.log("learn on show");
    },
    loadGroups: function () {
        // 只加载分组基本信息和统计字段
        const groups = storage.getAllGroups();
        this.setData({ groups });
      },
    onUnload: function () {
        console.log("learn on unload");
    },

    loadNextBatch(page) {
        const {
            groupId,
            pageSize
        } = this.data;
        const usePage = page || this.data.page;
        const unlearnedList = storage.getUnlearnedPaged(groupId, usePage, pageSize);
        const current = unlearnedList.length ? { ...unlearnedList[0] } : null;
        this.setData({
            unlearnedList,
            current,
            currentIndex: 0
        });
        storage.reportPerf();
    },

    // 新增：加载下一页
    loadMore() {
        if (!this.data.hasMore) return;
        const newPage = this.data.page + 1;
        const newBatchIndex = this.data.currentBatchIndex + 1;
        this.setData({
            page: newPage,
            currentBatchIndex: newBatchIndex,
        }, () => {
            this.loadNextBatch(newPage);
        });
    },

    // 统一批次完成处理
    handleBatchCompleted() {
        this.setData({
            current: null,
            unlearnedList: [],            
            cardTranslateX: 0,
            cardTransition: '',
            cardClass: '',
            cardRotate: 0
        });

        const {
            groupId,
            pageSize,
            currentBatchIndex,
            totalBatchCount
        } = this.data;

        let hasMore = totalBatchCount > currentBatchIndex;
        if (!hasMore) {
            storage.updateGroupStats(groupId);
            // 因为这里更新了所以要重新获取currentGroup
            const groups = storage.getAllGroups();
            const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
            const unlearnedCount = currentGroup.unlearnedCount;            
            if (unlearnedCount > 0) {
                // 考虑刚刚学完的，加这次新增的
                const newBatchCount = Math.ceil(unlearnedCount / pageSize) + totalBatchCount;
                this.setData({
                    isAllLearned: false,
                    isBatchCompleted: true,
                    hasMore: true,
                    totalBatchCount: newBatchCount,                    
                    page: 0, // 重置，因为loadMore会加一 ,
                    currentGroup 
                });
            } else {                
                const masteredCount = currentGroup.masteredCount;
                const dueCount = currentGroup.dueCount;
                this.setData({
                    isAllLearned: true,
                    isBatchCompleted: true,
                    masteredCount,
                    dueCount
                });
            }
        } else {
            this.setData({
                isAllLearned: false,
                isBatchCompleted: true,
                hasMore: true,
            });
        }        
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
                cardClass: '',
                cardRotate: 0,
            });
        } else {
            this.handleBatchCompleted();
        }
    },

    markLearned() {
        // 要先获取current，因为nextOne中会修改
        const currentKnowledge = this.data.unlearnedList[this.data.currentIndex];
        this.setData({ learnedCount: this.data.learnedCount + 1 });
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


    // 左右滑动切换卡片
    onTouchStart(e) {
        this.touchStartX = e.touches[0].clientX;
        this.touchDeltaX = 0;
    },

    onTouchMove(e) {
        this.touchDeltaX = e.touches[0].clientX - this.touchStartX;
        // 新增：滑动方向提示和位置
        const threshold = 60;
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        let cardClass = '';
        let hint = '';
        let cardRotate = 0;
        let cardTranslateX = 0;
        if (this.touchDeltaX <= -threshold) {
            cardClass = 'swipe-left';
            hint = '左滑表示已学会';
            cardRotate = -5;
            cardTranslateX = this.touchDeltaX;
        } else if (this.touchDeltaX >= threshold) {
            cardClass = 'swipe-right';
            hint = '右滑表示稍后学';
            cardRotate = 5;
            cardTranslateX = this.touchDeltaX;
        }
        // 卡片跟随手指移动
        this.setData({
            cardTranslateX,
            cardTransition: '',
            cardClass,
            cardRotate
        });
        this.throttledSetHint(hint, clientX, clientY);
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
                    else if (direction === 1) wx.showToast({title: '您向右滑动，表示稍后学习该知识点',icon: 'none'});
                    this.nextOne();
                }, 300);
            });

        } else {
            this.setData({
                cardTranslateX: 0,
                cardTransition: 'transform 0.2s',
                cardClass: '',
                cardRotate: 0
            });
        }
        this.throttledSetHint.clear && this.throttledSetHint.clear();  
        aSwipeHandler.reset.call(this);        
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
            storage.perfSetStorageSync('hideLearnGestureGuide', true);
            wx.showModal({
                title: '提示',
                content: '您向左滑动，表示已学会该知识点，将跳转至下一个知识点',
                showCancel: true,
                success: (res) => {
                    if (res.confirm) {
                        this.markLearned();
                        this.nextOne();
                    }
                }
            });
        } else if (deltaX >= 60) {
            // 右滑
            this.setData({
                showGestureGuide: false,
                gestureGuideActive: false
            });
            storage.perfSetStorageSync('hideLearnGestureGuide', true);
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


    toReviewPage() {
        // 跳转前主动刷新今日复习批次
        //storage.refreshAllReviewLists();
        wx.navigateTo({
            url: `/pages/review/review?groupId=${this.data.groupId}`
        });
    },

    toMastered() {
        const {
            groupId
        } = this.data
        if (!groupId) {
            wx.showToast({
                title: '分组ID缺失',
                icon: 'none'
            })
            return
        }
        wx.navigateTo({
            url: `/pages/mastered/mastered?groupId=${groupId}`
        })
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

                    this.nextOne(); // 删除一条后跳转下一条
                }
            }
        });
    },
});
