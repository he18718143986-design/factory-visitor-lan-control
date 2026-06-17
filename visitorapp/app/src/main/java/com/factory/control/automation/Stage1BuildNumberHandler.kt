@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.content.Intent
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.factory.control.AppDebugLog

/**
 * Stage1BuildNumberHandler — 连点版本号 7 次激活开发者模式
 */
class Stage1BuildNumberHandler(private val host: AutomationHost) : StageHandler {

    private companion object {
        const val TAG = "A11y"
    }

    private var clickCount = 0
    private var scrollCount = 0
    private var offSettingsRetryCount = 0
    private var sawPinVerification = false
    private var didPostPinTopUpClicks = false

    fun reset() {
        clickCount = 0
        scrollCount = 0
        offSettingsRetryCount = 0
        sawPinVerification = false
        didPostPinTopUpClicks = false
    }

    override fun handle() {
        if (!host.ensureWithinTotalTimeout("S1")) return
        if (clickCount > 0) return
        if (host.isDeveloperOptionsEnabled()) {
            Log.d(TAG, "S1: developer options already enabled, skip to Stage 2")
            host.report(step = 1, state = "DONE", msg = "开发者模式已开启")
            host.switchToStage2()
            return
        }
        val root = host.getRootNode() ?: run { Log.d(TAG, "S1: root null"); return }
        val profile = host.profile
        val title = PageDetector.getPageTitle(root, profile)
        Log.d(TAG, "S1: title='$title' scrollCount=$scrollCount")

        if (!PageDetector.isSettingsApp(root)) {
            offSettingsRetryCount++
            if (offSettingsRetryCount % 3 == 1) {
                try {
                    host.launchIntent(
                        Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "S1: reopen device info failed: ${e.message}")
                }
            }
            host.scheduleRetry(700) { handle() }
            root.recycle()
            return
        }
        offSettingsRetryCount = 0

        if (PageDetector.isOnMainSettingsPage(root, title, profile)) {
            Log.d(TAG, "S1: detected main Settings page, looking for About Phone entry")
            val aboutNode = NodeFinder.findAboutPhoneNode(root, profile)
            if (aboutNode != null) {
                val clickTarget = host.findBestClickable(aboutNode) ?: aboutNode
                Log.d(TAG, "S1: clicking About Phone entry: ${aboutNode.text}")
                clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                NodeFinder.recycleDistinct(clickTarget, aboutNode)
                host.scheduleRetry(800) { handle() }
            } else if (scrollCount < 8) {
                scrollCount++
                host.scheduleScroll { handle() }
            } else {
                host.fail("在设置列表中找不到「关于手机」入口，请手动进入并重新触发")
            }
            root.recycle()
            return
        }

        val node = NodeFinder.findByTexts(root, profile.buildNumberLabels)
        Log.d(TAG, "S1: node=${node?.text}  isClickable=${node?.isClickable}  class=${node?.className}")

        if (node == null) {
            if (scrollCount < 5) {
                scrollCount++
                host.scheduleScroll { handle() }
            } else {
                host.fail("找不到「版本号」，请确认处于关于手机页面")
            }
            root.recycle()
            return
        }

        val clickTarget = host.findBestClickable(node) ?: node
        clickBuildNumberOnce(labelNode = node, clickTarget = clickTarget)
        root.recycle()
    }

    private fun clickBuildNumberOnce(
        labelNode: AccessibilityNodeInfo,
        clickTarget: AccessibilityNodeInfo
    ) {
        if (clickCount >= 7) {
            host.report(step = 1, state = "IN_PROGRESS", msg = "等待开发者模式激活…")
            waitForDeveloperModeEnabled()
            return
        }
        clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        clickCount++
        host.report(step = 1, state = "IN_PROGRESS", msg = "正在点击版本号 ($clickCount/7)")
        NodeFinder.recycleDistinct(clickTarget, labelNode)
        host.scheduleRetry(250) { continueBuildNumberClickLoop() }
    }

    private fun continueBuildNumberClickLoop() {
        if (!host.ensureWithinTotalTimeout("S1")) return
        if (clickCount >= 7) {
            host.report(step = 1, state = "IN_PROGRESS", msg = "等待开发者模式激活…")
            waitForDeveloperModeEnabled()
            return
        }
        val root = host.getRootNode() ?: run {
            clickCount = 0
            host.isPendingRetry = true
            host.scheduleRetry(500) { handle() }
            return
        }
        try {
            host.dismissAnyDialog(root)
            val profile = host.profile
            val newNode = NodeFinder.findByTexts(root, profile.buildNumberLabels)
            if (newNode != null) {
                val newTarget = host.findBestClickable(newNode) ?: newNode
                clickBuildNumberOnce(newNode, newTarget)
            } else {
                Log.d(TAG, "S1: build number not found, re-entering stage")
                clickCount = 0
                host.isPendingRetry = true
                host.scheduleRetry(400) { handle() }
            }
        } catch (_: Exception) {
            clickCount = 0
            host.scheduleRetry(400) { handle() }
        } finally {
            root.recycle()
        }
    }

    private fun waitForDeveloperModeEnabled(pollCount: Int = 0) {
        if (!host.ensureWithinTotalTimeout("S1")) return
        val isEnabled = host.isDeveloperOptionsEnabled()
        val profile = host.profile

        Log.d(TAG, "S1: waitForDevMode poll=$pollCount enabled=$isEnabled")
        AppDebugLog.d(TAG, "S1 wait poll=$pollCount enabled=$isEnabled pinSeen=$sawPinVerification topUpDone=$didPostPinTopUpClicks")

        if (isEnabled) {
            host.report(step = 1, state = "DONE", msg = "开发者模式已激活")
            host.switchToStage2()
            return
        }
        val root = host.getRootNode()
        if (root != null) {
            try {
                val title = PageDetector.getPageTitle(root, profile)
                val onPin = PageDetector.isOnPinVerificationPage(root, title, profile)

                if (!onPin) {
                    if (!PageDetector.isSettingsApp(root)) {
                        if (pollCount % 5 == 0) {
                            Log.w(TAG, "S1 poll: not in settings pkg=${root.packageName}, pull back")
                            try {
                                host.launchIntent(
                                    Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                )
                            } catch (e: Exception) {
                                Log.w(TAG, "S1 poll pull_back failed: ${e.message}")
                            }
                        }
                    } else if (!PageDetector.isOnAboutPhonePage(root, title, profile) && pollCount > 0 && pollCount % 8 == 0) {
                        Log.w(TAG, "S1 poll: drifted from about phone title='$title', re-open")
                        try {
                            host.launchIntent(
                                Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        } catch (e: Exception) {
                            Log.w(TAG, "S1 poll re_nav failed: ${e.message}")
                        }
                    }
                }

                if (onPin) {
                    if (!sawPinVerification) {
                        AppDebugLog.i(TAG, "S1 detected PIN verification page, waiting user input")
                    }
                    sawPinVerification = true
                    host.report(step = 1, state = "IN_PROGRESS", msg = "检测到 PIN 校验，请输入后稍候…")
                } else if (!didPostPinTopUpClicks && isLikelyOnBuildNumberPage(root, title, profile) &&
                    (hasNeedOneMoreTapHint(root, profile) || pollCount >= 6)) {
                    val topUpClicks = doPostPinTopUpBuildNumberClicks(root, 1, profile)
                    if (topUpClicks > 0) {
                        didPostPinTopUpClicks = true
                        AppDebugLog.i(TAG, "S1 waiting-phase extra tap done clicks=$topUpClicks poll=$pollCount")
                        host.report(step = 1, state = "IN_PROGRESS", msg = "检测到仍需额外点击版本号，正在补点…")
                    }
                } else if (sawPinVerification && !didPostPinTopUpClicks) {
                    val topUpClicks = doPostPinTopUpBuildNumberClicks(root, 2, profile)
                    if (topUpClicks > 0) {
                        didPostPinTopUpClicks = true
                        AppDebugLog.i(TAG, "S1 post-PIN top-up clicks=$topUpClicks")
                        host.report(step = 1, state = "IN_PROGRESS", msg = "PIN 校验后补点版本号…")
                    }
                }
            } finally {
                root.recycle()
            }
        }
        if (pollCount >= 80) {
            host.fail("等待开发者模式激活超时，请手动进入设置开启")
            return
        }
        host.isPendingRetry = true
        host.scheduleRetry(300) { waitForDeveloperModeEnabled(pollCount + 1) }
    }

    private fun doPostPinTopUpBuildNumberClicks(
        root: AccessibilityNodeInfo,
        maxClicks: Int,
        profile: RomProfile
    ): Int {
        val node = NodeFinder.findByTexts(root, profile.buildNumberLabels) ?: return 0
        val clickTarget = host.findBestClickable(node) ?: node
        var clicks = 0
        repeat(maxClicks) {
            val ok = clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            if (ok) clicks++
        }
        NodeFinder.recycleDistinct(clickTarget, node)
        return clicks
    }

    private fun isLikelyOnBuildNumberPage(
        root: AccessibilityNodeInfo,
        title: String,
        profile: RomProfile
    ): Boolean {
        if (PageDetector.isOnAboutPhonePage(root, title, profile)) return true
        val buildNode = NodeFinder.findByTexts(root, profile.buildNumberLabels)
        val found = buildNode != null
        buildNode?.recycle()
        return found
    }

    private fun hasNeedOneMoreTapHint(root: AccessibilityNodeInfo, profile: RomProfile): Boolean =
        NodeFinder.hasAnyText(root, profile.needOneMoreTapHints)
}
