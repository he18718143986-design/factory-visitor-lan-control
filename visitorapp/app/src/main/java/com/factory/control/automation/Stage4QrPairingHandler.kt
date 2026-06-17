@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.factory.control.AppDebugLog

/**
 * Stage4QrPairingHandler — 打开二维码配对弹窗
 *
 * R-4: 等待上限从 25 轮缩短至 10 轮，每轮同步上报进度。
 */
class Stage4QrPairingHandler(private val host: AutomationHost) : StageHandler {

    private companion object {
        const val TAG = "A11y"
    }

    private var pairingWaitCount = 0
    private var qrEntryClickRetryCount = 0
    private var dialogConfirmClickRetryCount = 0

    fun reset() {
        pairingWaitCount = 0
        qrEntryClickRetryCount = 0
        dialogConfirmClickRetryCount = 0
    }

    override fun handle() {
        if (!host.ensureWithinTotalTimeout("S4")) return
        val root = host.getRootNode() ?: return
        try {
            if (host.dismissAnyDialog(root)) {
                host.scheduleRetry(600) { handle() }
                return
            }
            val profile = host.profile
            val qrEntry = NodeFinder.findByTexts(root, profile.qrPairingLabels)
            if (qrEntry != null) {
                Log.d(TAG, "S4: QR pairing entry found, clicking")
                val clicked = host.clickIfVisibleOrRetry(
                    "S4: QR pairing entry", "qr_entry", qrEntry
                ) {
                    if (qrEntryClickRetryCount++ < 2) {
                        Log.d(TAG, "S4: QR entry not visible, retry #$qrEntryClickRetryCount")
                        host.scheduleScroll { handle() }
                    } else {
                        host.fail("二维码入口不可见，请手动打开配对页")
                    }
                }
                if (clicked) {
                    qrEntryClickRetryCount = 0
                    waitForPairingDialog()
                }
            } else if (host.scrollCount < 5) {
                host.scheduleScroll { handle() }
            } else {
                host.fail("找不到「使用二维码配对」入口")
            }
        } finally {
            root.recycle()
        }
    }

    private fun waitForPairingDialog() {
        if (!host.ensureWithinTotalTimeout("S4")) return
        val profile = host.profile
        val root = host.getRootNode()
        if (root != null) {
            try {
                if (NodeFinder.isPairingDialogPresent(root, profile)) {
                    Log.d(TAG, "S4: QR Pairing dialog detected! ALL DONE.")
                    host.markDoneAndClearQueue(step = 4, msg = "配置完成，请扫码")
                    return
                }
            } finally {
                root.recycle()
            }
        }
        if (pairingWaitCount++ > 10) {
            host.fail("等待配对弹窗超时，请确认是否已手动关闭或文案不匹配")
            return
        }
        host.report(step = 4, state = "IN_PROGRESS", msg = "正在等待配对弹窗… ($pairingWaitCount/10)")
        Log.d(TAG, "S4: waiting for dialog... ($pairingWaitCount)")
        host.isPendingRetry = true
        host.scheduleRetry(800) { waitForPairingDialog() }
    }
}
