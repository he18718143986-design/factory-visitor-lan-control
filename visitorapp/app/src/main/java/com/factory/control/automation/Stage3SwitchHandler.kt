@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.content.Intent
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.factory.control.AppDebugLog

/**
 * Stage3SwitchHandler — 开启无线调试开关
 *
 * 含 forceRestart 子流程（关→开→确认）。
 */
class Stage3SwitchHandler(private val host: AutomationHost) : StageHandler {

    private companion object {
        const val TAG = "A11y"
        const val TRACE = "A11yTrace"
    }

    var forceRestartWirelessDebug = false
    var restartPhase = 0
    var restartToggleAttempts = 0
    private var offSettingsRetryCount = 0
    private var qrEntryClickRetryCount = 0
    private var dialogConfirmClickRetryCount = 0

    fun reset() {
        forceRestartWirelessDebug = false
        restartPhase = 0
        restartToggleAttempts = 0
        offSettingsRetryCount = 0
        qrEntryClickRetryCount = 0
        dialogConfirmClickRetryCount = 0
    }

    override fun handle() {
        if (!host.ensureWithinTotalTimeout("S3")) return
        val root = host.getRootNode() ?: return
        try {
            val profile = host.profile
            val title = PageDetector.getPageTitle(root, profile)
            if (!PageDetector.isOnWirelessDebugDetailPage(root, title, profile)) {
                AppDebugLog.w(TAG, "S3 guard: not on wireless detail page (title='$title'), back to Stage2")
                host.switchToStage2()
                return
            }

            if (!PageDetector.isSettingsApp(root)) {
                offSettingsRetryCount++
                Log.d(TRACE, "gate_s3_blocked retry=$offSettingsRetryCount pkg=${root.packageName}")
                if (offSettingsRetryCount % 2 == 1) {
                    try {
                        host.launchIntent(
                            Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    } catch (e: Exception) {
                        Log.w(TAG, "S3: reopen development settings failed: ${e.message}")
                    }
                }
                host.scheduleRetry(800) { handle() }
                return
            }
            offSettingsRetryCount = 0

            if (host.dismissAnyDialog(root)) {
                host.scheduleRetry(600) { handle() }
                return
            }

            val sw = NodeFinder.findWirelessDebugSwitch(root, profile)
            Log.d(TAG, "S3: switch=${sw?.className} checked=${sw?.isChecked} scroll=${host.scrollCount}")

            when {
                sw == null -> {
                    if (host.scrollCount < 8) {
                        host.scheduleScroll { handle() }
                    } else {
                        host.fail("未找到无线调试开关，请手动开启")
                    }
                }
                forceRestartWirelessDebug -> {
                    handleRestartWirelessDebug(sw)
                }
                NodeFinder.isEnabled(sw, profile) -> {
                    Log.d(TAG, "S3: Switch is ALREADY ON")
                    sw.recycle()
                    host.report(step = 3, state = "DONE", msg = "无线调试已开启")
                    host.scrollCount = 0
                    qrEntryClickRetryCount = 0
                    dialogConfirmClickRetryCount = 0
                    host.switchToStage4()
                }
                else -> {
                    Log.d(TAG, "S3: Clicking switch to enable")
                    val clickTarget = host.findBestClickable(sw) ?: sw
                    clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    NodeFinder.recycleDistinct(clickTarget, sw)
                    host.scheduleRetry(1000) { handle() }
                }
            }
        } finally {
            root.recycle()
        }
    }

    private fun handleRestartWirelessDebug(sw: AccessibilityNodeInfo) {
        val profile = host.profile
        val enabled = NodeFinder.isEnabled(sw, profile)
        when (restartPhase) {
            0 -> {
                if (enabled) {
                    if (restartToggleAttempts++ > 3) {
                        sw.recycle(); host.fail("重置无线调试失败，请手动操作")
                    } else {
                        Log.d(TAG, "S3: restart step=OFF attempt=$restartToggleAttempts")
                        val ct = host.findBestClickable(sw) ?: sw
                        ct.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        NodeFinder.recycleDistinct(ct, sw)
                        restartPhase = 1
                        host.scheduleRetry(1000) { handle() }
                    }
                } else {
                    sw.recycle()
                    restartPhase = 1
                    host.scheduleRetry(400) { handle() }
                }
            }
            1 -> {
                if (!enabled) {
                    if (restartToggleAttempts++ > 6) {
                        sw.recycle(); host.fail("重置无线调试失败，请手动操作")
                    } else {
                        Log.d(TAG, "S3: restart step=ON attempt=$restartToggleAttempts")
                        val ct = host.findBestClickable(sw) ?: sw
                        ct.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        NodeFinder.recycleDistinct(ct, sw)
                        restartPhase = 2
                        host.scheduleRetry(1000) { handle() }
                    }
                } else {
                    sw.recycle()
                    restartPhase = 0
                    host.scheduleRetry(400) { handle() }
                }
            }
            else -> {
                if (enabled) {
                    Log.d(TAG, "S3: restart done, proceed to pairing")
                    forceRestartWirelessDebug = false
                    restartPhase = 0
                    restartToggleAttempts = 0
                    sw.recycle()
                    host.report(step = 3, state = "DONE", msg = "无线调试已开启")
                    host.scrollCount = 0
                    qrEntryClickRetryCount = 0
                    dialogConfirmClickRetryCount = 0
                    host.switchToStage4()
                } else {
                    sw.recycle()
                    restartPhase = 1
                    host.scheduleRetry(400) { handle() }
                }
            }
        }
    }
}
