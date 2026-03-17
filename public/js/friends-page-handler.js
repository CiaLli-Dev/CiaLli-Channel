// 友情链接页面处理脚本
// 此脚本作为全局脚本加载，不受页面切换影响

(() => {
    console.log("[Friends Global] Script loaded");

    // 使用全局变量存储状态
    if (typeof window.friendsPageState === "undefined") {
        window.friendsPageState = {
            initialized: false,
            eventListeners: [],
            mutationObserver: null,
            copySuccessText: "已复制", // 默认值，会被页面覆盖
        };
    }

    // 初始化函数
    function initFriendsPage() {
        console.log("[Friends Global] initFriendsPage called");

        var friendsGrid = document.getElementById("friends-grid");
        var noResults = document.getElementById("no-results");

        // 如果关键元素不存在，直接返回
        if (!friendsGrid || !noResults) {
            return false;
        }

        var tagFilters = document.querySelectorAll(".filter-tag");
        var friendCards = document.querySelectorAll(".friend-card");
        var copyButtons = document.querySelectorAll(".copy-link-btn");

        console.log("[Friends Global] Found elements:", {
            cards: friendCards.length,
            filters: tagFilters.length,
            copyButtons: copyButtons.length,
        });

        // 从页面获取复制成功文本
        var copySuccessTextElement = document.getElementById(
            "friends-copy-success-text",
        );
        if (copySuccessTextElement) {
            window.friendsPageState.copySuccessText =
                copySuccessTextElement.textContent;
        }

        // 清理旧的事件监听器
        if (window.friendsPageState.eventListeners.length > 0) {
            console.log(
                "[Friends Global] Cleaning",
                window.friendsPageState.eventListeners.length,
                "old listeners",
            );
            for (
                let i = 0;
                i < window.friendsPageState.eventListeners.length;
                i++
            ) {
                const listener = window.friendsPageState.eventListeners[i];
                const element = listener[0];
                const type = listener[1];
                const handler = listener[2];
                if (element && element.removeEventListener) {
                    element.removeEventListener(type, handler);
                }
            }
            window.friendsPageState.eventListeners = [];
        }

        var currentTag = "all";

        function parseCardTags(card) {
            var jsonValue = card.getAttribute("data-tags") || "";
            if (!jsonValue) return [];
            try {
                var parsed = JSON.parse(jsonValue);
                if (Array.isArray(parsed)) {
                    return parsed
                        .map(function (tag) {
                            return String(tag || "").trim();
                        })
                        .filter(Boolean);
                }
            } catch (error) {
                console.warn("[Friends] Parse tags json failed:", error);
            }
            return [];
        }

        // 过滤函数
        function filterFriends() {
            var visibleCount = 0;
            for (let i = 0; i < friendCards.length; i++) {
                const card = friendCards[i];
                const tags = parseCardTags(card);

                var matchesTag =
                    currentTag === "all" || tags.indexOf(currentTag) >= 0;

                if (matchesTag) {
                    card.style.display = "";
                    visibleCount++;
                } else {
                    card.style.display = "none";
                }
            }

            if (visibleCount === 0) {
                noResults.classList.remove("hidden");
                friendsGrid.classList.add("hidden");
            } else {
                noResults.classList.add("hidden");
                friendsGrid.classList.remove("hidden");
            }
        }

        // 标签筛选
        for (let i = 0; i < tagFilters.length; i++) {
            ((button) => {
                var clickHandler = () => {
                    // 更新选中状态
                    for (let j = 0; j < tagFilters.length; j++) {
                        const btn = tagFilters[j];
                        btn.classList.remove("active");
                    }
                    button.classList.add("active");

                    currentTag = button.getAttribute("data-tag") || "all";
                    filterFriends();
                };
                button.addEventListener("click", clickHandler);
                window.friendsPageState.eventListeners.push([
                    button,
                    "click",
                    clickHandler,
                ]);
            })(tagFilters[i]);
        }

        // 复制链接功能
        for (let i = 0; i < copyButtons.length; i++) {
            ((button) => {
                var clickHandler = () => {
                    var url = button.getAttribute("data-url");
                    if (!url) return;

                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard
                            .writeText(url)
                            .then(() => {
                                const originalHTML = button.innerHTML;
                                button.innerHTML =
                                    '<div class="flex items-center gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span class="text-xs">' +
                                    window.friendsPageState.copySuccessText +
                                    "</span></div>";
                                button.classList.add("text-green-500");
                                setTimeout(() => {
                                    button.innerHTML = originalHTML;
                                    button.classList.remove("text-green-500");
                                }, 2000);
                            })
                            .catch((err) => {
                                console.error(
                                    "[Friends Global] Copy failed:",
                                    err,
                                );
                            });
                    }
                };
                button.addEventListener("click", clickHandler);
                window.friendsPageState.eventListeners.push([
                    button,
                    "click",
                    clickHandler,
                ]);
            })(copyButtons[i]);
        }

        window.friendsPageState.initialized = true;
        console.log(
            "[Friends Global] ✅ Initialization complete with",
            window.friendsPageState.eventListeners.length,
            "listeners",
        );
        return true;
    }

    // 带重试的初始化
    function tryInit(retries) {
        retries = retries || 0;
        if (initFriendsPage()) {
            console.log("[Friends Global] Init succeeded");
            return;
        }
        if (retries < 5) {
            setTimeout(() => {
                tryInit(retries + 1);
            }, 100);
        }
    }

    // MutationObserver 监听 DOM 变化
    function setupMutationObserver() {
        if (window.friendsPageState.mutationObserver) {
            window.friendsPageState.mutationObserver.disconnect();
        }

        window.friendsPageState.mutationObserver = new MutationObserver(
            (mutations) => {
                var shouldInit = false;
                for (let i = 0; i < mutations.length; i++) {
                    const mutation = mutations[i];
                    if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                        for (let j = 0; j < mutation.addedNodes.length; j++) {
                            const node = mutation.addedNodes[j];
                            if (node.nodeType === 1) {
                                if (
                                    node.id === "friends-grid" ||
                                    (node.querySelector &&
                                        node.querySelector("#friends-grid"))
                                ) {
                                    shouldInit = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldInit) break;
                }

                if (shouldInit) {
                    console.log("[Friends Global] DOM mutation detected");
                    window.friendsPageState.initialized = false;
                    setTimeout(() => {
                        tryInit();
                    }, 50);
                }
            },
        );

        window.friendsPageState.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    // 页面加载时初始化
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            console.log("[Friends Global] DOMContentLoaded");
            tryInit();
        });
    } else {
        tryInit();
    }

    // 启动 MutationObserver
    setupMutationObserver();

    // 监听所有可能的页面切换事件
    const events = ["astro:page-load", "astro:after-swap"];

    for (let i = 0; i < events.length; i++) {
        ((eventName) => {
            document.addEventListener(eventName, () => {
                console.log("[Friends Global] Event:", eventName);
                window.friendsPageState.initialized = false;
                setTimeout(() => {
                    tryInit();
                }, 100);
            });
        })(events[i]);
    }

    console.log("[Friends Global] All listeners registered");
})();
