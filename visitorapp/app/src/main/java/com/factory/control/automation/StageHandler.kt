package com.factory.control.automation

import android.view.accessibility.AccessibilityNodeInfo

/**
 * StageHandler — 阶段处理器接口
 *
 * 每个 Stage 的核心逻辑封装在独立的 Handler 中，
 * 由 SetupAutomationService.onAccessibilityEvent 分发调用。
 */
interface StageHandler {
    /**
     * 处理当前阶段的一次无障碍事件。
     * 由主服务在 onAccessibilityEvent 中调用。
     */
    fun handle()
}
