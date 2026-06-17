@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * PageDetector — 页面识别工具
 *
 * 通过标题资源 ID + 树上关键节点存在性来判断当前处于哪个设置页面。
 */
object PageDetector {

    // ── 页面标题获取 ──────────────────────────────────────────────

    fun getPageTitle(root: AccessibilityNodeInfo, profile: RomProfile): String {
        for (id in profile.titleResourceIds) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            try {
                nodes.firstOrNull()?.text?.toString()?.let { return it }
            } finally {
                nodes.forEach { it.recycle() }
            }
        }
        for (i in 0 until root.childCount) {
            val child = root.getChild(i) ?: continue
            try {
                val rect = Rect()
                child.getBoundsInScreen(rect)
                if (child.className?.contains("TextView") == true && rect.top < 200) {
                    child.text?.toString()?.let { return it }
                }
            } finally {
                child.recycle()
            }
        }
        return ""
    }

    // ── 具体页面判定 ──────────────────────────────────────────────

    fun isOnMainSettingsPage(root: AccessibilityNodeInfo, title: String, profile: RomProfile): Boolean {
        if (title.contains("设置") || title.contains("Settings") || title.isEmpty()) {
            val node = NodeFinder.findAboutPhoneNode(root, profile)
            node?.recycle()
            return node != null
        }
        return false
    }

    fun isOnDeveloperOptionsPage(root: AccessibilityNodeInfo, title: String, profile: RomProfile): Boolean {
        if (profile.devOptionsTitleKeywords.any { title.contains(it) }) return true
        for (label in profile.usbDebugLabels) {
            val nodes = root.findAccessibilityNodeInfosByText(label)
            val found = nodes.isNotEmpty()
            nodes.forEach { it.recycle() }
            if (found) return true
        }
        return false
    }

    fun isOnWirelessDebugPage(root: AccessibilityNodeInfo, title: String, profile: RomProfile): Boolean {
        if (profile.wirelessDebugTitleKeywords.any { title.contains(it) }) return true
        for (kw in profile.wirelessDetailKeywords) {
            val nodes = root.findAccessibilityNodeInfosByText(kw)
            val found = nodes.isNotEmpty()
            nodes.forEach { it.recycle() }
            if (found) return true
        }
        return false
    }

    /**
     * 比 isOnWirelessDebugPage 更严格：用于 Stage2→Stage3 过渡和 Stage3 页面守卫。
     * 避免在开发者列表页因标题/列表项命中"无线调试"而误入 Stage3。
     */
    fun isOnWirelessDebugDetailPage(
        root: AccessibilityNodeInfo,
        title: String,
        profile: RomProfile
    ): Boolean {
        val titleHit = profile.wirelessDebugTitleKeywords.any { title.contains(it) }
        val pairingHit = profile.wirelessDetailKeywords.any { kw ->
            val nodes = root.findAccessibilityNodeInfosByText(kw)
            val found = nodes.isNotEmpty()
            nodes.forEach { it.recycle() }
            found
        }
        val qrEntry = NodeFinder.findByTexts(root, profile.qrPairingLabels)
        val hasQrEntry = qrEntry != null
        qrEntry?.recycle()
        val devEntry = NodeFinder.findDeveloperOptionsEntryNode(root, profile)
        val hasDevEntry = devEntry != null
        devEntry?.recycle()

        if (pairingHit || hasQrEntry) return true
        if (titleHit && !hasDevEntry && !isOnDeveloperOptionsPage(root, title, profile)) return true
        return false
    }

    fun isOnAboutPhonePage(root: AccessibilityNodeInfo, title: String, profile: RomProfile): Boolean {
        if (profile.aboutPageTitleKeywords.any { title.contains(it, ignoreCase = true) }) {
            // 包含"关于/About"的标题大概率是关于手机页
            if (title.contains("关于") || title.contains("About")) return true
            // 否则需确认版本号节点存在
            val node = NodeFinder.findByTexts(root, profile.buildNumberLabels)
            node?.recycle()
            return node != null
        }
        return false
    }

    fun isOnPinVerificationPage(root: AccessibilityNodeInfo, title: String, profile: RomProfile): Boolean {
        if (profile.pinTitleHints.any { title.contains(it, ignoreCase = true) }) return true
        return NodeFinder.hasAnyText(root, profile.pinTextHints)
    }

    fun isSettingsApp(root: AccessibilityNodeInfo): Boolean {
        val pkg = root.packageName?.toString() ?: return false
        return pkg.contains("settings", ignoreCase = true) ||
            pkg.contains("setting", ignoreCase = true) ||
            pkg.contains("com.huawei.android", ignoreCase = true) ||
            pkg.contains("com.hihonor", ignoreCase = true) ||
            pkg.contains("com.android.settings", ignoreCase = true) ||
            pkg.endsWith(".settings", ignoreCase = true)
    }
}
