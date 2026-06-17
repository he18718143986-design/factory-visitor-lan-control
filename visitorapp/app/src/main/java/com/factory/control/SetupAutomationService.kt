@file:Suppress("DEPRECATION")
package com.factory.control

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import com.factory.control.automation.*

/**
 * SetupAutomationService — 自动完成开发者选项及无线调试配置
 *
 * 重构后作为薄编排层，核心逻辑委托给 automation 包下的模块化组件：
 *   - RomProfile        ROM 适配（资源 ID + 文本标签）
 *   - NodeFinder         无障碍节点搜索
 *   - PageDetector       页面识别
 *   - Stage1~5 Handler   各阶段处理器
 *
 * 保留说明（R-1 ~ R-6 标记继承自原版注释，逻辑已迁移到对应 Handler）：
 *   R-1  Stage2State data class
 *   R-2  Stage 2 分发器 + 8 辅助
 *   R-3  isEnabled 优先 isChecked
 *   R-4  waitForPairingDialog 上限 10 次
 *   R-5  scrollDown 优先 ACTION_SCROLL_FORWARD
 *   R-6  startRecoverPairingFlow 入口 reset()
 */
class SetupAutomationService : AccessibilityService(), AutomationHost {

    companion object {
        var instance: SetupAutomationService? = null
        const val BROADCAST_STEP   = "com.factory.control.AUTO_STEP"
        const val BROADCAST_DONE   = "com.factory.control.SETUP_COMPLETE"
        const val BROADCAST_FAILED = "com.factory.control.SETUP_FAILED"
        private const val TAG      = "A11y"
        private const val TRACE    = "A11yTrace"
        private const val QUICK_PATH_TAG = "A11yQuickPath"

        fun isAutomationInProgress(): Boolean =
            instance?.let { it.stage != Stage.IDLE && it.stage != Stage.DONE } ?: false
    }

    enum class Stage {
        IDLE,
        CLICKING_BUILD_NUMBER,
        OPENING_WIRELESS_DEBUG,
        ENABLING_SWITCH,
        OPENING_QR_PAIRING,
        DISABLING_DEV_OPTIONS,
        DONE
    }

    // ── 状态 ──────────────────────────────────────────────────────

    internal var stage = Stage.IDLE
    override var isPendingRetry = false
    override var scrollCount = 0
    private var flowStartElapsedMs: Long = 0
    private val totalFlowTimeoutMs = 3 * 60 * 1000L
    private val handler = Handler(Looper.getMainLooper())

    // ── ROM Profile（延迟初始化）──────────────────────────────────

    private var _profile: RomProfile? = null
    override val profile: RomProfile
        get() {
            _profile?.let { return it }
            val root = rootInActiveWindow
            val pkg = root?.packageName?.toString() ?: "com.android.settings"
            root?.recycle()
            val p = RomProfile.detect(pkg)
            _profile = p
            return p
        }

    // ── Stage 处理器 ──────────────────────────────────────────────

    private val s1 = Stage1BuildNumberHandler(this)
    private val s2 = Stage2NavigationHandler(this)
    private val s3 = Stage3SwitchHandler(this)
    private val s4 = Stage4QrPairingHandler(this)
    private val s5 = Stage5DisableDevHandler(this)

    // ─── 生命周期 ────────────────────────────────────────────────

    override fun onServiceConnected() {
        instance = this
        Log.d(TAG, "Service connected")
        AppDebugLog.i(TAG, "Service connected")
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    /**
     * 由后端/ADB 成功信号触发的兜底停止。
     */
    fun stopAutomation(reason: String = "后端已确认配对成功，停止自动化") {
        val curStage = stage
        if (curStage == Stage.IDLE || curStage == Stage.DONE) return
        if (curStage == Stage.DISABLING_DEV_OPTIONS) {
            handler.removeCallbacksAndMessages(null)
            isPendingRetry = false
            reset()
            stage = Stage.DONE
            return
        }
        val doneStep = when (curStage) {
            Stage.CLICKING_BUILD_NUMBER  -> 1
            Stage.OPENING_WIRELESS_DEBUG -> 2
            Stage.ENABLING_SWITCH        -> 3
            Stage.OPENING_QR_PAIRING     -> 4
            else -> 0
        }
        Log.d(TAG, "stopAutomation curStage=$curStage doneStep=$doneStep reason=$reason")
        reset()
        stage = Stage.DONE
        report(step = doneStep, state = "DONE", msg = reason)
        sendBroadcast(Intent(BROADCAST_DONE).apply { setPackage(packageName) })
    }

    // ─── 外部入口 ─────────────────────────────────────────────────

    fun startDevModeAutomation() {
        abortDisablingDevOptionsIfRunning()
        if (stage != Stage.IDLE && stage != Stage.DONE) return
        reset()
        markFlowStart()
        if (isDeveloperOptionsEnabled()) {
            Log.d(TAG, "startDevMode: developer options already enabled, skip Stage 1")
            report(step = 1, state = "DONE", msg = "开发者模式已开启，跳过激活步骤")
            switchToStage2()
            return
        }
        stage = Stage.CLICKING_BUILD_NUMBER
        report(step = 1, state = "IN_PROGRESS", msg = "正在打开「关于手机」…")
        handler.postDelayed({
            startActivity(
                Intent(Settings.ACTION_DEVICE_INFO_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }, 100)
    }

    fun startQrPairingIfWirelessDebugEnabled(): Boolean {
        abortDisablingDevOptionsIfRunning()
        if (stage != Stage.IDLE && stage != Stage.DONE) return false
        val enabled = isWirelessDebuggingEnabled()
        Log.d(QUICK_PATH_TAG, "quick_path_check enabled=$enabled stage=$stage")
        if (!enabled) return false
        reset()
        markFlowStart()
        Log.d(QUICK_PATH_TAG, "quick_path_start skip_stage1=true")
        report(step = 1, state = "DONE", msg = "无线调试已开启，正在打开配对页…")
        switchToStage2()
        return true
    }

    fun startRecoverPairingFlow(): Boolean {
        abortDisablingDevOptionsIfRunning()
        if (stage != Stage.IDLE && stage != Stage.DONE) return false
        reset()
        markFlowStart()
        s3.forceRestartWirelessDebug = true
        s3.restartPhase = 0
        s3.restartToggleAttempts = 0
        report(step = 3, state = "IN_PROGRESS", msg = "正在重置无线调试…")
        switchToStage2()
        return true
    }

    fun startDisableDeveloperOptionsAfterExit() {
        if (stage != Stage.IDLE && stage != Stage.DONE) return
        if (!isDeveloperOptionsEnabled()) {
            Log.d(TAG, "disableDevAfterExit: development_settings_enabled already off")
            return
        }
        reset()
        stage = Stage.DISABLING_DEV_OPTIONS
        s5.start(this)
    }

    private fun abortDisablingDevOptionsIfRunning() {
        if (stage != Stage.DISABLING_DEV_OPTIONS) return
        Log.d(TAG, "abortDisablingDevOptionsIfRunning")
        isPendingRetry = false
        handler.removeCallbacksAndMessages(null)
        reset()
        stage = Stage.DONE
    }

    // ─── 事件入口 ────────────────────────────────────────────────

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return
        if (isPendingRetry) return
        when (stage) {
            Stage.CLICKING_BUILD_NUMBER  -> s1.handle()
            Stage.OPENING_WIRELESS_DEBUG -> s2.handle()
            Stage.ENABLING_SWITCH        -> s3.handle()
            Stage.OPENING_QR_PAIRING     -> s4.handle()
            Stage.DISABLING_DEV_OPTIONS  -> s5.handle()
            else -> {}
        }
    }

    // ─── AutomationHost 实现 ─────────────────────────────────────

    override fun getRootNode(): AccessibilityNodeInfo? = rootInActiveWindow

    override fun launchIntent(intent: Intent) {
        startActivity(intent)
    }

    override fun globalBack() {
        performGlobalAction(GLOBAL_ACTION_BACK)
    }

    override fun scrollDown() {
        val root = rootInActiveWindow
        if (root != null) {
            try {
                val scrollable = findScrollableContainer(root)
                if (scrollable != null) {
                    val ok = scrollable.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                    scrollable.recycle()
                    if (ok) {
                        Log.d(TAG, "scrollDown: used ACTION_SCROLL_FORWARD")
                        return
                    }
                }
            } finally {
                root.recycle()
            }
        }
        val m = resources.displayMetrics
        val aspectRatio = m.heightPixels.toFloat() / m.widthPixels.toFloat()
        val (startFrac, endFrac) = if (aspectRatio < 1.2f) 0.62f to 0.38f else 0.72f to 0.28f
        Log.d(TAG, "scrollDown: gesture fallback aspectRatio=${"%.2f".format(aspectRatio)}")
        val path = Path().apply {
            moveTo(m.widthPixels / 2f, m.heightPixels * startFrac)
            lineTo(m.widthPixels / 2f, m.heightPixels * endFrac)
        }
        dispatchGesture(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 400))
                .build(),
            null, null
        )
    }

    override fun scheduleRetry(delayMs: Long, action: () -> Unit) {
        isPendingRetry = true
        handler.postDelayed({
            isPendingRetry = false
            action()
        }, delayMs)
    }

    override fun scheduleScroll(retry: () -> Unit) {
        scrollCount++
        isPendingRetry = true
        scrollDown()
        handler.postDelayed({
            isPendingRetry = false
            retry()
        }, 500)
    }

    override fun findBestClickable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        val owned = mutableListOf<AccessibilityNodeInfo>()
        for (i in 0 until 5) {
            val temp = current ?: break
            if (temp.isClickable && temp.isEnabled && temp.isVisibleToUser) {
                owned.filter { it !== temp }.forEach { it.recycle() }
                return temp
            }
            current = temp.parent
            if (temp !== node) owned += temp
        }
        owned.forEach { it.recycle() }
        return null
    }

    override fun clickIfVisibleOrRetry(
        label: String,
        reason: String,
        node: AccessibilityNodeInfo,
        onNotVisible: () -> Unit
    ): Boolean {
        val clickTarget = findBestClickable(node) ?: node
        if (!clickTarget.isVisibleToUser) {
            Log.d(TAG, "$label target not visible, skip click (reason=$reason)")
            NodeFinder.recycleDistinct(clickTarget, node)
            onNotVisible()
            return false
        }
        val clicked = clickTarget.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        if (!clicked && !clickTarget.isClickable) tryClickParentOrSibling(clickTarget)
        NodeFinder.recycleDistinct(clickTarget, node)
        return clicked
    }

    private fun tryClickParentOrSibling(node: AccessibilityNodeInfo) {
        var current: AccessibilityNodeInfo? = node
        val ownedParents = mutableListOf<AccessibilityNodeInfo>()
        for (i in 0 until 8) {
            val p = current?.parent ?: break
            current = p
            ownedParents += p
            if (p.isClickable && p.isEnabled) {
                p.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                Log.d(TAG, "clicked parent at depth $i")
                break
            }
        }
        ownedParents.forEach { it.recycle() }
    }

    override fun dismissAnyDialog(root: AccessibilityNodeInfo): Boolean {
        if (!canAutoDismissDialogOnCurrentPage(root)) return false
        val labels = dialogConfirmLabelsForCurrentStage()
        for (label in labels) {
            val nodes = root.findAccessibilityNodeInfosByText(label)
            var clicked = false
            for (node in nodes) {
                if (!clicked && node.isEnabled && isInDialog(node)) {
                    var scheduledRetry = false
                    val didClick = clickIfVisibleOrRetry(
                        label = "Dialog confirm",
                        reason = "stage=$stage label=$label",
                        node = node
                    ) {
                        scheduledRetry = true
                        retryCurrentStageAfterDialog(400)
                    }
                    if (didClick || scheduledRetry) clicked = true
                } else {
                    node.recycle()
                }
            }
            if (clicked) return true
        }
        return false
    }

    private fun dialogConfirmLabelsForCurrentStage(): List<String> {
        val stageStr = stage.name
        return profile.dialogConfirmLabels(stageStr)
    }

    private fun canAutoDismissDialogOnCurrentPage(root: AccessibilityNodeInfo): Boolean {
        if (!PageDetector.isSettingsApp(root)) return false
        return stage in listOf(
            Stage.CLICKING_BUILD_NUMBER,
            Stage.OPENING_WIRELESS_DEBUG,
            Stage.ENABLING_SWITCH,
            Stage.OPENING_QR_PAIRING
        )
    }

    private fun isInDialog(node: AccessibilityNodeInfo): Boolean {
        val tempParents = mutableListOf<AccessibilityNodeInfo>()
        var current: AccessibilityNodeInfo? = node
        for (i in 0 until 5) {
            val temp = current ?: break
            val cn = temp.className?.toString() ?: ""
            if (cn == "android.app.AlertDialog" ||
                cn == "androidx.appcompat.app.AlertDialog" ||
                (cn.contains("AlertDialog") && !cn.contains("Preference"))) {
                tempParents.forEach { it.recycle() }
                return true
            }
            val parent = temp.parent ?: break
            tempParents += parent
            current = parent
        }
        tempParents.forEach { it.recycle() }
        return false
    }

    private fun retryCurrentStageAfterDialog(delayMs: Long) {
        isPendingRetry = true
        handler.postDelayed({
            isPendingRetry = false
            when (stage) {
                Stage.CLICKING_BUILD_NUMBER  -> s1.handle()
                Stage.OPENING_WIRELESS_DEBUG -> s2.handle()
                Stage.ENABLING_SWITCH        -> s3.handle()
                Stage.OPENING_QR_PAIRING     -> s4.handle()
                else -> {}
            }
        }, delayMs)
    }

    override fun report(step: Int, state: String, msg: String) {
        AppDebugLog.i(TAG, "step=$step state=$state stage=${this.stage} msg=$msg")
        sendBroadcast(Intent(BROADCAST_STEP).apply {
            setPackage(packageName)
            putExtra("step", step)
            putExtra("state", state)
            putExtra("msg", msg)
        })
    }

    override fun fail(reason: String) {
        Log.w(TAG, "FAIL: $reason")
        AppDebugLog.w(TAG, "fail stage=$stage reason=$reason")
        val failedStep = when (stage) {
            Stage.CLICKING_BUILD_NUMBER  -> 1
            Stage.OPENING_WIRELESS_DEBUG -> 2
            Stage.ENABLING_SWITCH        -> 3
            Stage.OPENING_QR_PAIRING     -> 4
            else -> 0
        }
        stage = Stage.IDLE
        isPendingRetry = false
        handler.removeCallbacksAndMessages(null)
        report(step = failedStep, state = "FAILED", msg = reason)
        sendBroadcast(Intent(BROADCAST_FAILED).apply { setPackage(packageName); putExtra("reason", reason) })
    }

    override fun markDoneAndClearQueue(step: Int, msg: String) {
        stage = Stage.DONE
        isPendingRetry = false
        handler.removeCallbacksAndMessages(null)
        report(step = step, state = "DONE", msg = msg)
        sendBroadcast(Intent(BROADCAST_DONE).apply { setPackage(packageName) })
    }

    override fun isDeveloperOptionsEnabled(): Boolean {
        return try {
            Settings.Global.getInt(contentResolver, "development_settings_enabled", 0) == 1
        } catch (_: Exception) { false }
    }

    override fun isWirelessDebuggingEnabled(): Boolean {
        return try {
            val adbWifi = Settings.Global.getInt(contentResolver, "adb_wifi_enabled", 0)
            if (adbWifi == 1) return true
            Settings.Global.getInt(contentResolver, "wireless_debugging_enabled", 0) == 1
        } catch (_: Exception) { false }
    }

    override fun switchToStage2() {
        stage = Stage.OPENING_WIRELESS_DEBUG
        markFlowStartIfNeeded()
        s2.goToWirelessDebugging()
    }

    override fun switchToStage3() {
        stage = Stage.ENABLING_SWITCH
        scrollCount = 0
        s3.handle()
    }

    override fun switchToStage4() {
        stage = Stage.OPENING_QR_PAIRING
        scrollCount = 0
        s4.handle()
    }

    override fun switchToStage5Done() {
        stage = Stage.DONE
        handler.removeCallbacksAndMessages(null)
    }

    override fun ensureWithinTotalTimeout(stageTag: String): Boolean {
        if (flowStartElapsedMs == 0L) return true
        val elapsed = SystemClock.elapsedRealtime() - flowStartElapsedMs
        if (elapsed <= totalFlowTimeoutMs) return true
        Log.w(TAG, "flow timeout stage=$stageTag elapsedMs=$elapsed limitMs=$totalFlowTimeoutMs")
        fail("自动化总超时（${totalFlowTimeoutMs / 1000}s），请手动完成")
        return false
    }

    override fun tryClickSearchButtonToOpen(root: AccessibilityNodeInfo): Boolean {
        val hints = profile.searchHints
        for (hint in hints) {
            val byText = root.findAccessibilityNodeInfosByText(hint)
            var clicked = false
            var processedUntil = -1
            for (i in byText.indices) {
                val n = byText[i]
                var scheduledRetry = false
                val didClick = clickIfVisibleOrRetry(
                    label = "S2: search button",
                    reason = "tryClickSearchButtonToOpen",
                    node = n
                ) {
                    scheduledRetry = true
                    scheduleRetry(500) { s2.handle() }
                }
                if (didClick || scheduledRetry) {
                    clicked = true; processedUntil = i; break
                }
                processedUntil = i
            }
            for (i in (processedUntil + 1) until byText.size) byText[i].recycle()
            if (clicked) return true
        }
        return false
    }

    override fun trySearchInSettings(
        root: AccessibilityNodeInfo,
        query: String,
        onResult: (Boolean) -> Unit
    ) {
        val searchNode = NodeFinder.findSearchBox(root, profile) ?: run { onResult(false); return }
        val clicked = searchNode.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        Log.d(TAG, "S2: search box click(聚焦)=$clicked")
        searchNode.recycle()
        isPendingRetry = true
        handler.postDelayed({
            isPendingRetry = false
            val newRoot = rootInActiveWindow ?: run { onResult(false); return@postDelayed }
            val newSearchNode = NodeFinder.findSearchBox(newRoot, profile) ?: run {
                newRoot.recycle(); onResult(false); return@postDelayed
            }
            val bundle = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, query)
            }
            val ok = newSearchNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle)
            Log.d(TAG, "S2: search box setText($query)=$ok")
            newSearchNode.recycle()
            newRoot.recycle()
            onResult(ok)
        }, 400)
    }

    // ─── 内部工具 ────────────────────────────────────────────────

    private fun findScrollableContainer(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        for (i in 0 until root.childCount) root.getChild(i)?.let { queue.addLast(it) }
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node.isScrollable) {
                while (queue.isNotEmpty()) queue.removeFirst().recycle()
                return node
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.addLast(it) }
            node.recycle()
        }
        return null
    }

    private fun reset() {
        scrollCount = 0
        isPendingRetry = false
        flowStartElapsedMs = 0
        s1.reset()
        s2.reset()
        s3.reset()
        s4.reset()
        s5.reset()
        handler.removeCallbacksAndMessages(null)
    }

    private fun markFlowStart() {
        flowStartElapsedMs = SystemClock.elapsedRealtime()
    }

    private fun markFlowStartIfNeeded() {
        if (flowStartElapsedMs == 0L) flowStartElapsedMs = SystemClock.elapsedRealtime()
    }
}
