@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * AutomationHost — Stage Handler 回调接口
 *
 * 封装 SetupAutomationService 向各 StageHandler 暴露的能力，
 * 避免 Handler 直接引用 AccessibilityService 子类。
 */
interface AutomationHost {

    /** 当前 ROM 适配 */
    val profile: RomProfile

    // ── 无障碍树 ──────────────────────────────────────────────────

    /** 获取当前活跃窗口根节点（可能为 null） */
    fun getRootNode(): AccessibilityNodeInfo?

    // ── Activity 启动 ─────────────────────────────────────────────

    fun launchIntent(intent: Intent)

    // ── 全局操作 ──────────────────────────────────────────────────

    fun globalBack()

    // ── 滚动 ─────────────────────────────────────────────────────

    fun scrollDown()

    // ── 调度 ─────────────────────────────────────────────────────

    fun scheduleRetry(delayMs: Long, action: () -> Unit)
    fun scheduleScroll(retry: () -> Unit)

    // ── 点击工具 ──────────────────────────────────────────────────

    fun findBestClickable(node: AccessibilityNodeInfo): AccessibilityNodeInfo?

    /**
     * 点击可见节点，不可见时执行 onNotVisible 回调。
     * 返回 true 表示成功点击。
     */
    fun clickIfVisibleOrRetry(
        label: String,
        reason: String,
        node: AccessibilityNodeInfo,
        onNotVisible: () -> Unit
    ): Boolean

    // ── 弹窗 ─────────────────────────────────────────────────────

    fun dismissAnyDialog(root: AccessibilityNodeInfo): Boolean

    // ── 广播 & 状态 ──────────────────────────────────────────────

    fun report(step: Int, state: String, msg: String)
    fun fail(reason: String)
    fun markDoneAndClearQueue(step: Int, msg: String)

    // ── 开发者模式查询 ───────────────────────────────────────────

    fun isDeveloperOptionsEnabled(): Boolean
    fun isWirelessDebuggingEnabled(): Boolean

    // ── Stage 切换 ───────────────────────────────────────────────

    fun switchToStage2()
    fun switchToStage3()
    fun switchToStage4()
    fun switchToStage5Done()

    // ── pending 标志（防抖）────────────────────────────────────

    var isPendingRetry: Boolean

    // ── 超时检查 ─────────────────────────────────────────────────

    fun ensureWithinTotalTimeout(stageTag: String): Boolean

    // ── 滚动计数（共享状态）────────────────────────────────────

    var scrollCount: Int

    // ── 搜索工具 ──────────────────────────────────────────────────

    fun tryClickSearchButtonToOpen(root: AccessibilityNodeInfo): Boolean
    fun trySearchInSettings(root: AccessibilityNodeInfo, query: String, onResult: (Boolean) -> Unit)
}
