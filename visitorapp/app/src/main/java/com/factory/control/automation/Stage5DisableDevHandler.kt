@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import com.factory.control.AppDebugLog

/**
 * Stage5DisableDevHandler — 离厂后关闭开发者选项总开关
 *
 * 独立计时（不走总超时 fail()），失败仅 Toast。
 */
class Stage5DisableDevHandler(private val host: AutomationHost) : StageHandler {

    private companion object {
        const val TAG = "A11y"
    }

    private var disableDevFlowStartMs = 0L
    private var disableDevRetryCount = 0
    private val disableDevMaxMs = 120_000L

    fun reset() {
        disableDevFlowStartMs = 0L
        disableDevRetryCount = 0
    }

    fun start(context: android.content.Context) {
        disableDevFlowStartMs = SystemClock.elapsedRealtime()
        disableDevRetryCount = 0
        host.scrollCount = 0
        host.report(step = 5, state = "IN_PROGRESS", msg = "正在关闭开发者选项…")
        AppDebugLog.i(TAG, "disableDevAfterExit start")
        host.scheduleRetry(400) {
            try {
                host.launchIntent(
                    Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                Log.w(TAG, "disableDevAfterExit intent failed: ${e.message}")
                Toast.makeText(
                    context,
                    "无法打开开发者选项，请在设置中手动关闭开发者模式。",
                    Toast.LENGTH_LONG
                ).show()
                host.switchToStage5Done()
            }
        }
    }

    override fun handle() {
        val elapsed = SystemClock.elapsedRealtime() - disableDevFlowStartMs
        if (elapsed > disableDevMaxMs) {
            finishManual()
            return
        }
        if (!host.isDeveloperOptionsEnabled()) {
            finishSuccess()
            return
        }
        val root = host.getRootNode() ?: run {
            host.scheduleRetry(500) { handle() }
            return
        }
        try {
            val profile = host.profile
            val title = PageDetector.getPageTitle(root, profile)
            if (host.dismissAnyDialog(root)) {
                host.scheduleRetry(600) { handle() }
                return
            }
            if (!PageDetector.isSettingsApp(root)) {
                host.report(
                    step = 5,
                    state = "IN_PROGRESS",
                    msg = "请输入解锁密码或验证身份，完成后将自动继续关闭开发者选项…"
                )
                host.scheduleRetry(1500) { handle() }
                return
            }
            if (PageDetector.isOnDeveloperOptionsPage(root, title, profile)) {
                val sw = NodeFinder.findDeveloperOptionsMasterSwitch(root, profile)
                when {
                    sw == null -> {
                        if (host.scrollCount < 8) {
                            host.scheduleScroll { handle() }
                        } else {
                            finishManual()
                        }
                    }
                    !NodeFinder.isEnabled(sw, profile) -> {
                        sw.recycle()
                        if (!host.isDeveloperOptionsEnabled()) {
                            finishSuccess()
                        } else {
                            host.scheduleRetry(800) { handle() }
                        }
                    }
                    else -> {
                        val clickTarget = host.findBestClickable(sw) ?: sw
                        clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        NodeFinder.recycleDistinct(clickTarget, sw)
                        host.report(step = 5, state = "IN_PROGRESS", msg = "正在关闭开发者选项总开关…")
                        host.scheduleRetry(1200) { handle() }
                    }
                }
                return
            }
            val devEntry = NodeFinder.findDeveloperOptionsEntryNode(root, profile)
            if (devEntry != null && disableDevRetryCount < 14) {
                disableDevRetryCount++
                val clickTarget = host.findBestClickable(devEntry) ?: devEntry
                clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                NodeFinder.recycleDistinct(clickTarget, devEntry)
                host.report(step = 5, state = "IN_PROGRESS", msg = "正在打开开发者选项…")
                host.scheduleRetry(900) { handle() }
                return
            }
            disableDevRetryCount++
            if (disableDevRetryCount > 18) {
                finishManual()
            } else {
                if (disableDevRetryCount % 6 == 0) {
                    try {
                        host.launchIntent(
                            Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "disableDev: reopen dev settings failed: ${e.message}")
                    }
                }
                host.scheduleRetry(800) { handle() }
            }
        } finally {
            root.recycle()
        }
    }

    private fun finishSuccess() {
        host.isPendingRetry = false
        host.switchToStage5Done()
        host.report(step = 5, state = "DONE", msg = "开发者选项已关闭")
        AppDebugLog.i(TAG, "disableDevAfterExit success")
    }

    private fun finishManual() {
        host.isPendingRetry = false
        host.switchToStage5Done()
        AppDebugLog.w(TAG, "disableDevAfterExit manual/timeout")
    }
}
