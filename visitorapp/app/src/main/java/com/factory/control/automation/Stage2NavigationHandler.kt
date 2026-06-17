@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.factory.control.AppDebugLog

/**
 * Stage2NavigationHandler — 跳转到无线调试页面
 *
 * 包含 R-1 Stage2State、R-2 分发器 + 8 个辅助方法。
 */
class Stage2NavigationHandler(private val host: AutomationHost) : StageHandler {

    private companion object {
        const val TAG = "A11y"
        const val TRACE = "A11yTrace"
    }

    /** R-1: Stage 2 状态对象 */
    data class Stage2State(
        var triedSearchWireless: Boolean = false,
        var triedSearchDeveloper: Boolean = false,
        var triedClickSearchButtonForWireless: Boolean = false,
        var triedClickSearchButtonForDev: Boolean = false,
        var wirelessSearchInFlight: Boolean = false,
        var wirelessSearchResultRetries: Int = 0,
        var devNodeTotalClickAttempts: Int = 0,
        var settingsPageClickRetries: Int = 0,
        var waitForSearchBoxRetries: Int = 0,
        var searchButtonClickRetryCount: Int = 0,
        var aboutPhoneToMainCount: Int = 0,
        var justDidBackFromAboutPhone: Boolean = false,
        var titleLogged: Boolean = false,
        var devOptionsEntered: Boolean = false,
        var devOptionsScrollCount: Int = 0,
        var scrollWirelessAfterSearchClick: Boolean = false
    )

    private var s2 = Stage2State()
    var totalWirelessRetryCount = 0
    var s2BothSearchesRestartAttempts = 0
    var s2CatchAllRestartAttempts = 0
    private var retryCount = 0
    private var offSettingsRetryCount = 0

    fun reset() {
        s2 = Stage2State()
        totalWirelessRetryCount = 0
        s2BothSearchesRestartAttempts = 0
        s2CatchAllRestartAttempts = 0
        retryCount = 0
        offSettingsRetryCount = 0
    }

    fun goToWirelessDebugging() {
        host.scrollCount = 0
        retryCount = 0
        offSettingsRetryCount = 0
        s2 = Stage2State()
        if (totalWirelessRetryCount++ > 15) {
            host.fail("多次尝试均无法进入无线调试，请手动操作")
            return
        }
        host.report(step = 2, state = "IN_PROGRESS", msg = "正在进入无线调试…")
        host.isPendingRetry = true
        val intentOk = tryIntentDirectly()
        if (!intentOk) {
            try {
                host.launchIntent(
                    Intent(Settings.ACTION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                Log.w(TAG, "S2: startActivity(SETTINGS) failed: ${e.message}")
            }
        }
        host.scheduleRetry(800) { handle() }
    }

    private fun tryIntentDirectly(): Boolean {
        val intents = listOf(
            Intent("com.android.settings.WIRELESS_DEBUGGING_SETTINGS"),
            Intent().setClassName(
                "com.android.settings",
                "com.android.settings.development.WirelessDebuggingActivity"
            )
        )
        for (intent in intents) {
            try {
                host.launchIntent(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (_: Exception) {}
        }
        return false
    }

    // ── R-2: 分发器 ──────────────────────────────────────────────

    override fun handle() {
        if (!host.ensureWithinTotalTimeout("S2")) return
        val root = host.getRootNode() ?: run {
            Log.d(TAG, "S2: root null, retry in 500ms")
            host.scheduleRetry(500) { handle() }
            return
        }
        try {
            val profile = host.profile
            val title = PageDetector.getPageTitle(root, profile)
            val pkg = root.packageName?.toString() ?: ""
            val onSettings = PageDetector.isSettingsApp(root) || title.contains("设置") || title.contains("Settings")
            val onAbout = PageDetector.isOnAboutPhonePage(root, title, profile)
            val onDevOpts = PageDetector.isOnDeveloperOptionsPage(root, title, profile)
            val onWirelessDetail = PageDetector.isOnWirelessDebugDetailPage(root, title, profile)
            val onDevOptsEffective = onDevOpts || (
                s2.scrollWirelessAfterSearchClick &&
                    PageDetector.isSettingsApp(root) &&
                    !onAbout &&
                    !onWirelessDetail
                )
            if (!onDevOpts && !s2.scrollWirelessAfterSearchClick) {
                s2.devOptionsEntered = false
                s2.devOptionsScrollCount = 0
            }
            if (!s2.titleLogged) {
                Log.d(TAG, "S2: title_once='$title' pkg=${root.packageName}")
                s2.titleLogged = true
            }
            Log.d(TAG, "S2: title='$title' scroll=${host.scrollCount} retry=$retryCount")

            val wireNode = NodeFinder.findWirelessDebugEntryNode(root, profile)
            val devNode = NodeFinder.findDeveloperOptionsEntryNode(root, profile)
            AppDebugLog.d(
                TAG,
                "S2 dispatch title='$title' pkg=$pkg onSettings=$onSettings onAbout=$onAbout " +
                    "onDevOpts=$onDevOpts onWirelessDetail=$onWirelessDetail " +
                    "wireNode=${wireNode != null} devNode=${devNode != null} " +
                    "searchInFlight=${s2.wirelessSearchInFlight} searchedWireless=${s2.triedSearchWireless}"
            )

            when {
                onWirelessDetail -> {
                    AppDebugLog.i(TAG, "S2 branch=on_wireless_detail")
                    wireNode?.recycle(); devNode?.recycle()
                    handleWirelessPageReached()
                }
                onDevOptsEffective -> {
                    AppDebugLog.i(
                        TAG,
                        "S2 branch=on_dev_options eff=$onDevOptsEffective " +
                            "(titleMatch=$onDevOpts scrollAfterSearch=${s2.scrollWirelessAfterSearchClick})"
                    )
                    devNode?.recycle()
                    handleOnDevOptionsPage(root, wireNode)
                }
                wireNode != null -> {
                    AppDebugLog.i(TAG, "S2 branch=wire_entry_found")
                    devNode?.recycle()
                    handleWirelessEntryFound(root, wireNode)
                }
                onAbout && !s2.justDidBackFromAboutPhone -> {
                    AppDebugLog.i(TAG, "S2 branch=about_phone_navigation")
                    wireNode?.recycle(); devNode?.recycle()
                    handleAboutPhoneNavigation()
                }
                else -> {
                    AppDebugLog.i(TAG, "S2 branch=settings_or_unknown")
                    handleSettingsOrUnknownPage(root, title, devNode)
                }
            }
        } finally {
            root.recycle()
        }
    }

    private fun handleWirelessPageReached() {
        Log.d(TAG, "S2: reason=on_wireless_debug_page")
        AppDebugLog.i(TAG, "S2 reached wireless detail, switch to Stage3")
        s2.scrollWirelessAfterSearchClick = false
        s2.triedSearchWireless = true
        s2.wirelessSearchInFlight = false
        s2.wirelessSearchResultRetries = 0
        host.scrollCount = 0
        s2BothSearchesRestartAttempts = 0
        s2CatchAllRestartAttempts = 0
        host.report(step = 2, state = "IN_PROGRESS", msg = "已进入无线调试页")
        host.switchToStage3()
    }

    private fun handleOnDevOptionsPage(root: AccessibilityNodeInfo, wireNode: AccessibilityNodeInfo?) {
        Log.d(TAG, "S2: reason=on_developer_options_page")
        s2BothSearchesRestartAttempts = 0
        s2CatchAllRestartAttempts = 0
        if (!s2.devOptionsEntered) {
            s2.devOptionsEntered = true
            s2.devOptionsScrollCount = 0
            AppDebugLog.i(TAG, "S2: enter dev options page, reset dedicated scroll counter")
        }
        s2.settingsPageClickRetries = 0
        if (wireNode != null) {
            s2.triedSearchWireless = true
            s2.wirelessSearchInFlight = false
            s2.wirelessSearchResultRetries = 0
            Log.d(TAG, "S2: 无线调试 found in dev list, clicking")
            if (!PageDetector.isSettingsApp(root)) {
                wireNode.recycle()
                host.scheduleRetry(500) { handle() }
                return
            }
            val clicked = host.clickIfVisibleOrRetry(
                "S2: wireless entry", "developer_options_list", wireNode
            ) {
                scheduleDevOptionsScroll()
            }
            if (clicked) host.scheduleRetry(600) { handle() }
        } else if (s2.devOptionsScrollCount < 22) {
            scheduleDevOptionsScroll()
        } else {
            host.fail("在开发者选项列表中找不到无线调试入口")
        }
    }

    private fun scheduleDevOptionsScroll() {
        s2.devOptionsScrollCount++
        AppDebugLog.d(TAG, "S2: dev options dedicated scroll #${s2.devOptionsScrollCount}")
        host.isPendingRetry = true
        host.scrollDown()
        host.scheduleRetry(500) { handle() }
    }

    private fun handleWirelessEntryFound(root: AccessibilityNodeInfo, wireNode: AccessibilityNodeInfo) {
        Log.d(TAG, "S2: reason=wire_entry_found")
        s2BothSearchesRestartAttempts = 0
        s2CatchAllRestartAttempts = 0
        s2.triedSearchWireless = true
        s2.wirelessSearchInFlight = false
        s2.wirelessSearchResultRetries = 0
        if (!PageDetector.isSettingsApp(root)) {
            wireNode.recycle()
            host.scheduleRetry(500) { handle() }
            return
        }
        val clicked = host.clickIfVisibleOrRetry(
            "S2: wireless entry", "search_result_or_other", wireNode
        ) {
            host.scheduleRetry(600) { handle() }
        }
        if (clicked) {
            s2.scrollWirelessAfterSearchClick = true
            AppDebugLog.i(TAG, "S2: search_wire_click expect dev-options list scroll path")
            host.scheduleRetry(600) { handle() }
        }
    }

    private fun handleAboutPhoneNavigation() {
        s2CatchAllRestartAttempts = 0
        s2.aboutPhoneToMainCount++
        if (s2.aboutPhoneToMainCount <= 2) {
            Log.d(TAG, "S2: on About phone, launch main Settings (attempt ${s2.aboutPhoneToMainCount})")
            host.report(step = 2, state = "IN_PROGRESS", msg = "正在打开设置首页…")
            try {
                host.launchIntent(
                    Intent(Settings.ACTION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                )
            } catch (e: Exception) {
                Log.w(TAG, "S2: ACTION_SETTINGS failed: ${e.message}")
                host.globalBack()
            }
            host.scheduleRetry(800) { handle() }
        } else {
            Log.d(TAG, "S2: About phone → single Back, delay 1200ms")
            host.report(step = 2, state = "IN_PROGRESS", msg = "正在返回上一页…")
            host.globalBack()
            s2.justDidBackFromAboutPhone = true
            host.scheduleRetry(1200) {
                s2.justDidBackFromAboutPhone = false
                handle()
            }
        }
    }

    private fun handleSettingsOrUnknownPage(
        root: AccessibilityNodeInfo,
        title: String,
        devNode: AccessibilityNodeInfo?
    ) {
        val profile = host.profile
        val onSettings = PageDetector.isSettingsApp(root) || title.contains("设置") || title.contains("Settings")
        val onDevOpts = PageDetector.isOnDeveloperOptionsPage(root, title, profile)
        val onWireless = PageDetector.isOnWirelessDebugPage(root, title, profile)

        val stuckBothSearches = onSettings && !onDevOpts && !onWireless &&
            s2.triedSearchWireless && s2.triedSearchDeveloper
        if (!stuckBothSearches) s2BothSearchesRestartAttempts = 0

        when {
            onSettings && !onDevOpts && !onWireless &&
                !s2.triedSearchWireless && !s2.wirelessSearchInFlight -> {
                devNode?.recycle()
                s2CatchAllRestartAttempts = 0
                Log.d(TAG, "S2: reason=search_wireless_first")
                initiateWirelessSearch(root)
            }

            s2.wirelessSearchInFlight && !onWireless -> {
                devNode?.recycle()
                s2CatchAllRestartAttempts = 0
                s2.wirelessSearchResultRetries++
                if (s2.wirelessSearchResultRetries >= 3) {
                    Log.d(TAG, "S2: wireless search no result after retries, mark tried")
                    s2.triedSearchWireless = true
                    s2.wirelessSearchInFlight = false
                    s2.wirelessSearchResultRetries = 0
                    host.scheduleRetry(500) { handle() }
                } else {
                    host.scheduleRetry(600) { handle() }
                }
            }

            onSettings && !onDevOpts && !onWireless &&
                s2.triedSearchWireless && !s2.triedSearchDeveloper -> {
                devNode?.recycle()
                s2CatchAllRestartAttempts = 0
                Log.d(TAG, "S2: reason=search_developer_after_wireless")
                initiateDeveloperSearch(root)
            }

            onSettings && !onDevOpts && !onWireless &&
                s2.triedSearchWireless && s2.triedSearchDeveloper -> {
                devNode?.recycle()
                s2BothSearchesRestartAttempts++
                if (s2BothSearchesRestartAttempts <= 3) {
                    Log.d(TAG, "S2: searches tried, restart Stage2 attempt=$s2BothSearchesRestartAttempts")
                    host.scheduleRetry(600) { goToWirelessDebugging() }
                } else {
                    Log.w(TAG, "S2: fail after searches tried title='$title' pkg=${root.packageName}")
                    host.fail("多次尝试均无法进入无线调试，请手动操作")
                }
            }

            !onSettings && !onDevOpts && !onWireless -> {
                devNode?.recycle()
                s2CatchAllRestartAttempts = 0
                Log.d(TAG, "S2: unrecognized page pkg=${root.packageName} title='$title'")
                host.scheduleRetry(500) { handle() }
            }

            else -> {
                devNode?.recycle()
                s2CatchAllRestartAttempts++
                if (s2CatchAllRestartAttempts > 10) {
                    Log.w(TAG, "S2: catch-all restart limit title='$title' pkg=${root.packageName}")
                    host.fail("多次尝试均无法进入无线调试，请手动操作")
                } else {
                    Log.d(TAG, "S2: catch-all restart attempt=$s2CatchAllRestartAttempts")
                    host.scheduleRetry(600) { goToWirelessDebugging() }
                }
            }
        }
    }

    private fun initiateWirelessSearch(root: AccessibilityNodeInfo) {
        val profile = host.profile
        val searchBox = NodeFinder.findSearchBox(root, profile)
        if (searchBox != null) {
            s2.waitForSearchBoxRetries = 0
            s2.wirelessSearchInFlight = true
            s2.wirelessSearchResultRetries = 0
            searchBox.recycle()
            host.report(step = 2, state = "IN_PROGRESS", msg = "正在设置中搜索「无线」…")
            host.trySearchInSettings(root, "无线") { ok ->
                host.scheduleRetry(if (ok) 700 else 500) { handle() }
            }
        } else if (!s2.triedClickSearchButtonForWireless && host.tryClickSearchButtonToOpen(root)) {
            s2.triedClickSearchButtonForWireless = true
            s2.wirelessSearchInFlight = true
            s2.wirelessSearchResultRetries = 0
            host.scheduleRetry(700) { handle() }
        } else if (s2.waitForSearchBoxRetries < 2) {
            s2.waitForSearchBoxRetries++
            Log.d(TAG, "S2: search box not ready, wait retry #${s2.waitForSearchBoxRetries}")
            host.scheduleRetry(800) { handle() }
        } else {
            s2.waitForSearchBoxRetries = 0
            s2.triedSearchWireless = true
            s2.wirelessSearchInFlight = false
            host.scheduleRetry(500) { handle() }
        }
    }

    private fun initiateDeveloperSearch(root: AccessibilityNodeInfo) {
        val profile = host.profile
        val searchBox = NodeFinder.findSearchBox(root, profile)
        if (searchBox != null) {
            s2.waitForSearchBoxRetries = 0
            s2.triedSearchDeveloper = true
            searchBox.recycle()
            host.report(step = 2, state = "IN_PROGRESS", msg = "正在设置中搜索「开发」…")
            host.trySearchInSettings(root, "开发") { ok ->
                host.scheduleRetry(if (ok) 700 else 500) { handle() }
            }
        } else if (!s2.triedClickSearchButtonForDev && host.tryClickSearchButtonToOpen(root)) {
            s2.triedClickSearchButtonForDev = true
            host.scheduleRetry(700) { handle() }
        } else if (s2.waitForSearchBoxRetries < 2) {
            s2.waitForSearchBoxRetries++
            host.scheduleRetry(800) { handle() }
        } else {
            Log.w(TAG, "S2: no search box (pkg=${root.packageName}), mark developer search tried")
            s2.waitForSearchBoxRetries = 0
            s2.triedSearchDeveloper = true
            host.scheduleRetry(500) { handle() }
        }
    }
}
