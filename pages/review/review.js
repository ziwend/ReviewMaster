// review.js
const storage = require('../../utils/storage');
const {
    createSwipeHandler,
    throttle
} = require('../../utils/swipeHint');

// 创建问题和答案区域的手势处理器
const qSwipeHandler = createSwipeHandler('q');
const aSwipeHandler = createSwipeHandler('a');

// 常量定义
const FEEDBACK_SCORE = {
    REMEMBER: 5, // 记住了
    VAGUE: 3, // 模糊
    FORGET: 1 // 没记住
};

// 时间格式化工具函数
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60 * 1000) return Math.floor(diff / 1000) + '秒前';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + '小时前';
    return Math.floor(diff / 86400000) + '天前';
}


Page({
    data: {
        reviewList: [], // 当前批次待复习知识点
        currentIndex: 0,
        current: null,
        currentGroup: {},
        isBatchCompleted: false,
        isAllReviewed: false,
        totalBatchCount: 0,
        masteredCount: 0,
        unlearnedCount: 0,
        remainingCount: 0,
        groupId: null,
        hasMore: true,
        cardTranslateX: 0,
        cardTransition: '',
        cardClass: '', // 新增：卡片类名
        cardRotate: 0,
        qSwipeHint: '', // 问题区滑动提示
        qSwipeHintX: null,
        qSwipeHintY: null,
        aSwipeHint: '', // 答案区滑动提示
        aSwipeHintX: null,
        aSwipeHintY: null,
        showGestureGuide: true,
        gestureGuideActive: true,
        gestureGuideTouchStartY: 0,
        showResult: false,
        lastRememberAgo: null
    },

    settings: {}, // 存储设置

    onLoad: function (options) {
        const {
            groupId
        } = options;

        const groups = storage.getAllGroups();
        const currentGroup = groups.find(g => g.id == groupId) || {};
        if (currentGroup.name) {
            wx.setNavigationBarTitle({
                title: currentGroup.name
            });
        }
        const hideGuide = storage.perfGetStorageSync('hideReviewGestureGuide');
        this.settings = storage.getSettings();
        const pageSize = this.settings.batchSize || 20;
        const allDueCount = currentGroup.dueCount;
        const totalBatchCount = Math.ceil(allDueCount / pageSize);
        this.setData({
            groupId,
            currentGroup,
            currentBatchIndex: 1,
            totalBatchCount,
            page: 1, // 当前分页页码
            pageSize,
            showGestureGuide: !hideGuide,
            gestureGuideActive: !hideGuide
        }, () => {
            this.loadNextBatch();
        });

        this.qThrottledSetHint = throttle((hint, x, y) => {
            qSwipeHandler.updateHint.call(this, hint, x, y);
        }, 50);
        this.aThrottledSetHint = throttle((hint, x, y) => {
            aSwipeHandler.updateHint.call(this, hint, x, y);
        }, 50);
    },

    onShow: function () {
        this.loadGroups();
        this.settings = storage.getSettings();
        console.log("review on show");
    },
    loadGroups: function () {
        // 只加载分组基本信息和统计字段
        const groups = storage.getAllGroups();
        this.setData({ groups });
      },
    loadNextBatch(page) {
        const {
            groupId,
            pageSize
        } = this.data;
        const usePage = page || this.data.page;
        const reviewList = storage.getTodayReviewList(groupId, usePage, pageSize);
        const current = reviewList.length ? { ...reviewList[0] } : null;
        this.setData({
            reviewList,
            current,
            currentIndex: 0, //新的批次重新从0开始            
        });
        if (current) {
            this.setData({
                lastRememberAgo: this.getLastRememberAgo(current)
            });
        }

        storage.reportPerf();
    },

    // 加载下一页
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

    handleBatchCompleted() {
        this.setData({
            current: null,
            reviewList: [],
            cardTranslateX: 0,
            cardTransition: '',
            cardClass: '',
            cardRotate: 0,
            showResult: false,
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
            const groups = storage.getAllGroups();
            const currentGroup = groups.find(g => g.id == groupId) || (groups && groups[0]) || {};
            const dueCount = currentGroup.dueCount;

            if (dueCount > 0) {
                // 考虑刚刚学完的，加这次新增的
                const newBatchCount = Math.ceil(dueCount / pageSize) + totalBatchCount;

                this.setData({
                    isAllReviewed: false,
                    isBatchCompleted: true,
                    hasMore: true,
                    totalBatchCount: newBatchCount,
                    page: 0, // 重置，因为loadMore会加一 ,
                    currentGroup
                });
            } else { // 刷新后还是没有待复习的
                const masteredCount = currentGroup.masteredCount;
                const unlearnedCount = currentGroup.unlearnedCount;
                this.setData({
                    isAllReviewed: true,
                    isBatchCompleted: true,
                    masteredCount,
                    unlearnedCount,
                });
            }

        } else {
            this.setData({
                isAllReviewed: false,
                isBatchCompleted: true,
                hasMore: true,
            });
        }

    },

    nextOne() {
        let {
            reviewList,
            currentIndex
        } = this.data;

        if (currentIndex < reviewList.length - 1) {
            // 先清空所有卡片相关状态，再切换current，确保新卡片不会继承旧class
            this.setData({
                currentIndex: currentIndex + 1,
                current: reviewList[currentIndex + 1],
                cardTranslateX: 0,
                cardTransition: '',
                cardClass: '',
                cardRotate: 0,
                showResult: false,
            });

            this.setData({
                lastRememberAgo: this.getLastRememberAgo(this.data.current),
            });

        } else {
            this.handleBatchCompleted();
        }
    },

    /**
     * 计算知识点最后记忆时间描述
     * 优化：返回"xx前记住了/模糊/没记住"
     */
    getLastRememberAgo(current) {
        if (!current?.history?.length) return '';
        // 取最后一次有quality的记录
        const last = [...current.history].reverse().find(h => typeof h.quality === 'number');
        if (!last) return '';
        let feedback = '';
        if (last.quality >= 5) feedback = '记住了';
        else if (last.quality >= 3) feedback = '模糊';
        else feedback = '没记住';
        return `${formatTimeAgo(last.time)}${feedback}`;
    },

    // 统一处理复习反馈
    handleReviewFeedback(type) {
        const quality = FEEDBACK_SCORE[type.toUpperCase()] || 0;
        let {
            current,
            groupId
        } = this.data;

        // 首次复习时初始化算法字段
        if (current && !current.learned) {
            current.learned = true;
            // 初始化SM-2算法字段
            if (typeof current.repetition === 'undefined') current.repetition = 0;
            // 新增：优先用分组efactor
            let groupEfactor = (this.settings.groupEfactorMap && this.settings.groupEfactorMap[groupId]) || this.settings.efactor || 2.5;
            if (typeof current.efactor === 'undefined') current.efactor = groupEfactor;
        }
        // 使用SM-2算法更新知识点
        current = storage.updateKnowledgeBySM2(current, quality);
        // 严格掌握条件：连续6次正确且易记因子≥2.5
        if (current.repetition > 5 && current.efactor >= 2.5) {
            current.status = 'mastered';
        }
        // 普通复习状态
        else if (current.efactor >= 2.0) {
            current.status = 'reviewing';
        }
        // 需重新学习
        else {
            current.status = 'pending';
            current.repetition = 0;
        }
        storage.saveKnowledge(current);
    },

    markResult(e) {
        const type = e.currentTarget.dataset.result;
        this.handleReviewFeedback(type);
        this.nextOne();
    },

    // 题目区：只处理上下滑
    onQuestionTouchStart(e) {
        this.qTouchStartY = e.touches[0].clientY;
        this.qTouchDeltaY = 0;
    },
    onQuestionTouchMove(e) {
        this.qTouchDeltaY = e.touches[0].clientY - this.qTouchStartY;
        const threshold = 30;
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;

        let hint = '';
        if (this.qTouchDeltaY <= -threshold) {
            hint = '上滑显示答案';
        } else if (this.qTouchDeltaY >= threshold) {
            hint = '下滑显示答案';
        }
        this.qThrottledSetHint(hint, clientX, clientY);
    },
    onQuestionTouchEnd(e) {
        const threshold = 30;
        if (this.qTouchDeltaY >= threshold) {
            //下滑
            this.setData({
                showResult: true
            });
        } else if (this.qTouchDeltaY <= -threshold) {
            // 上滑
            this.setData({
                showResult: true
            });
        }
        this.qTouchStartY = 0;
        this.qTouchDeltaY = 0;
        this.qThrottledSetHint.clear && this.qThrottledSetHint.clear();
        qSwipeHandler.reset.call(this);
        
    },

    // 答案区：只处理左右滑
    onAnswerTouchStart(e) {
        this.aTouchStartX = e.touches[0].clientX;
        this.aTouchDeltaX = 0;
    },

    onAnswerTouchMove(e) {
        this.aTouchDeltaX = e.touches[0].clientX - this.aTouchStartX;
        // 新增：滑动方向提示和位置
        const threshold = 60;
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        let cardClass = '';
        let hint = '';
        let cardRotate = 0;
        let cardTranslateX = 0;
        if (this.aTouchDeltaX <= -threshold) {
            cardClass = 'swipe-left';
            hint = '左滑表示已记住';
            cardRotate = -5;
            cardTranslateX = this.aTouchDeltaX;
        } else if (this.aTouchDeltaX >= threshold) {
            cardClass = 'swipe-right';
            hint = '右滑表示没记住';
            cardRotate = 5;
            cardTranslateX = this.aTouchDeltaX;
        }
        // 卡片跟随手指移动
        this.setData({
            cardTranslateX,
            cardTransition: '',
            cardClass,
            cardRotate
        });
        this.aThrottledSetHint(hint, clientX, clientY);
    },

    onAnswerTouchEnd(e) {
        const threshold = 60;
        let animateOut = false;
        let direction = 0;
        if (this.aTouchDeltaX <= -threshold) {
            // 左滑，已学会
            animateOut = true;
            direction = -1; // 左滑
        } else if (this.aTouchDeltaX >= threshold) {
            // 右滑，已学会
            animateOut = true;
            direction = 1; // 右滑
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
                    if (direction === -1) {
                        this.markResult({
                            currentTarget: {
                                dataset: {
                                    result: 'remember'
                                }
                            }
                        });
                    } else if (direction === 1) {
                        this.markResult({
                            currentTarget: {
                                dataset: {
                                    result: 'forget'
                                }
                            }
                        });
                    }
                }, 300);
            });
        } else { // 没有达到滑动阈值自动复位
            this.setData({
                cardTranslateX: 0,
                cardTransition: 'transform 0.2s',
                cardClass: '',
                cardRotate: 0
            });
        }
        this.aThrottledSetHint.clear && this.aThrottledSetHint.clear();
        aSwipeHandler.reset.call(this);
    },



    onGestureGuideTouchStart(e) {
        // 阻止事件冒泡，防止传递到下层卡片
        if (e.stopPropagation) e.stopPropagation();
        this.setData({
            gestureGuideTouchStartY: e.touches[0].clientY
        });
    },

    onGestureGuideTouchEnd(e) {
        // 阻止事件冒泡，防止传递到下层卡片
        if (e.stopPropagation) e.stopPropagation();
        if (!this.data.gestureGuideActive) return;
        const deltaY = e.changedTouches[0].clientY - this.data.gestureGuideTouchStartY;
        if (deltaY >= 60) {
            // 下滑
            this.setData({
                showGestureGuide: false,
                gestureGuideActive: false
            });
            storage.perfSetStorageSync('hideReviewGestureGuide', true);
            wx.showModal({
                title: '提示',
                content: '您向下滑动，将显示答案',
                showCancel: true,
                success: (res) => {
                    if (res.confirm) {
                        this.markResult({
                            currentTarget: {
                                dataset: {
                                    result: 'remember'
                                }
                            }
                        });
                    }
                }
            });
        } else if (deltaY <= -60) {
            // 上滑
            this.setData({
                showGestureGuide: false,
                gestureGuideActive: false
            });
            storage.perfSetStorageSync('hideReviewGestureGuide', true);
            wx.showModal({
                title: '提示',
                content: '您向上滑动，将显示答案',
                showCancel: true,
                success: (res) => {
                    if (res.confirm) {
                        this.markResult({
                            currentTarget: {
                                dataset: {
                                    result: 'forget'
                                }
                            }
                        });
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

    // 跳转去学习
    toLearnPage() {
        wx.navigateTo({
            url: `/pages/learn/learn?groupId=${this.data.groupId}`
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

    /**
     * 页面隐藏时，清除定时器
     */
    onHide: function () { },
})
