@file:Suppress("DEPRECATION")
package com.factory.control.automation

import android.graphics.Rect
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo

/**
 * NodeFinder — 无障碍节点搜索工具
 *
 * 核心策略：资源 ID 优先 → 文本回退。
 * 每个 find* 方法先尝试 findAccessibilityNodeInfosByViewId，
 * 找不到时降级到 findAccessibilityNodeInfosByText。
 */
object NodeFinder {

    private const val TAG = "A11y"

    // ── 通用搜索 ──────────────────────────────────────────────────

    /**
     * 优先尝试资源 ID 列表，失败后用文本标签列表回退。
     * 返回第一个命中的节点（调用者负责 recycle）。
     */
    fun findPrefer(
        root: AccessibilityNodeInfo,
        resourceIds: List<String>,
        textLabels: List<String>
    ): AccessibilityNodeInfo? {
        findByResourceIds(root, resourceIds)?.let { return it }
        return findByTexts(root, textLabels)
    }

    /** 遍历资源 ID 列表，返回第一个命中的节点 */
    fun findByResourceIds(
        root: AccessibilityNodeInfo,
        ids: List<String>
    ): AccessibilityNodeInfo? {
        for (id in ids) {
            val nodes = root.findAccessibilityNodeInfosByViewId(id)
            if (nodes.isNotEmpty()) {
                nodes.drop(1).forEach { it.recycle() }
                return nodes[0]
            }
            nodes.forEach { it.recycle() }
        }
        return null
    }

    /** 遍历文本标签列表，返回第一个命中的节点 */
    fun findByTexts(
        root: AccessibilityNodeInfo,
        labels: List<String>
    ): AccessibilityNodeInfo? {
        for (label in labels) {
            val nodes = root.findAccessibilityNodeInfosByText(label)
            if (nodes.isNotEmpty()) {
                nodes.drop(1).forEach { it.recycle() }
                return nodes[0]
            }
            nodes.forEach { it.recycle() }
        }
        return null
    }

    /** 检查文本列表中是否有任何匹配（不保留节点引用） */
    fun hasAnyText(root: AccessibilityNodeInfo, labels: List<String>): Boolean {
        for (label in labels) {
            val nodes = root.findAccessibilityNodeInfosByText(label)
            val found = nodes.isNotEmpty()
            nodes.forEach { it.recycle() }
            if (found) return true
        }
        return false
    }

    // ── 关于手机 / 版本号 ─────────────────────────────────────────

    fun findAboutPhoneNode(root: AccessibilityNodeInfo, profile: RomProfile): AccessibilityNodeInfo? =
        findByTexts(root, profile.aboutPhoneLabels)

    fun findBuildNumberNode(root: AccessibilityNodeInfo, profile: RomProfile): AccessibilityNodeInfo? =
        findByTexts(root, profile.buildNumberLabels)

    // ── 开发者选项入口（BFS + 包含匹配）──────────────────────────

    fun findDeveloperOptionsEntryNode(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        val keywords = profile.devOptionsLabels
        return findByTreeBfs(
            root = root,
            maxVisited = 1500,
            maxDepth = 10
        ) { node ->
            val cn = node.className?.toString() ?: ""
            if (cn.contains("EditText", ignoreCase = true)) return@findByTreeBfs false
            val text = node.text?.toString()
            val desc = node.contentDescription?.toString()
            (text != null && keywords.any { kw -> text.contains(kw, ignoreCase = true) }) ||
                (desc != null && keywords.any { kw -> desc.contains(kw, ignoreCase = true) })
        }
    }

    // ── 无线调试入口（三级回退链）─────────────────────────────────

    fun findWirelessDebugEntryNode(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        // Level 1: 精确文本匹配（19 个变体）
        for (label in profile.wirelessDebugLabels) {
            val nodes = root.findAccessibilityNodeInfosByText(label)
            for (n in nodes) {
                if (n.className?.toString()?.contains("EditText") == true) {
                    n.recycle(); continue
                }
                nodes.filter { it !== n }.forEach { it.recycle() }
                return n
            }
            nodes.forEach { it.recycle() }
        }
        // Level 2: 分词匹配
        findWirelessDebugBySplitLabel(root, profile)?.let { return it }
        // Level 3: 宽松 BFS 文本匹配
        findWirelessDebugByLooseText(root, profile)?.let { return it }
        return null
    }

    private fun findWirelessDebugBySplitLabel(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        for (wirePart in profile.wirelessTokens) {
            val nodes = root.findAccessibilityNodeInfosByText(wirePart)
            for (n in nodes) {
                if (n.className?.toString()?.contains("EditText") == true) {
                    n.recycle(); continue
                }
                val nodeText = (n.text?.toString() ?: "") + " " + (n.contentDescription?.toString() ?: "")
                val parent = n.parent
                val parentText = if (parent != null) {
                    (parent.text?.toString() ?: "") + " " + (parent.contentDescription?.toString() ?: "")
                } else ""
                val hasDebugInNodeOrParent = profile.debugTokens.any {
                    nodeText.contains(it, ignoreCase = true) || parentText.contains(it, ignoreCase = true)
                }
                val hasDebugInParentSubtree = parent?.let { hasDescendantText(it, profile.debugTokens) } ?: false
                if (hasDebugInNodeOrParent || hasDebugInParentSubtree) {
                    nodes.filter { it !== n }.forEach { it.recycle() }
                    parent?.recycle()
                    return n
                }
                parent?.recycle()
                n.recycle()
            }
        }
        return null
    }

    private fun findWirelessDebugByLooseText(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        val maxVisited = 3000
        var visited = 0
        for (i in 0 until root.childCount) root.getChild(i)?.let { queue.addLast(it) }
        while (queue.isNotEmpty() && visited < maxVisited) {
            val node = queue.removeFirst()
            visited++
            val cls = node.className?.toString() ?: ""
            if (!cls.contains("EditText")) {
                val t = ((node.text?.toString() ?: "") + " " + (node.contentDescription?.toString() ?: "")).trim()
                if (isWirelessDebugLooseText(t, profile)) {
                    while (queue.isNotEmpty()) queue.removeFirst().recycle()
                    return node
                }
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.addLast(it) }
            node.recycle()
        }
        // 超限后回收队列中残留节点
        while (queue.isNotEmpty()) queue.removeFirst().recycle()
        return null
    }

    private fun isWirelessDebugLooseText(text: String, profile: RomProfile): Boolean {
        if (text.isBlank()) return false
        val t = text.lowercase()
        return profile.wirelessTokens.any { t.contains(it.lowercase()) } &&
            profile.debugTokens.any { t.contains(it.lowercase()) }
    }

    private fun hasDescendantText(root: AccessibilityNodeInfo, tokens: List<String>): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        for (i in 0 until root.childCount) root.getChild(i)?.let { queue.addLast(it) }
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val t = ((node.text?.toString() ?: "") + " " + (node.contentDescription?.toString() ?: "")).lowercase()
            if (tokens.any { t.contains(it.lowercase()) }) {
                while (queue.isNotEmpty()) queue.removeFirst().recycle()
                node.recycle()
                return true
            }
            for (i in 0 until node.childCount) node.getChild(i)?.let { queue.addLast(it) }
            node.recycle()
        }
        return false
    }

    // ── QR 配对入口 ───────────────────────────────────────────────

    fun findQrPairingEntry(root: AccessibilityNodeInfo, profile: RomProfile): AccessibilityNodeInfo? =
        findByTexts(root, profile.qrPairingLabels)

    // ── 开发者选项总开关（Stage 5）─────────────────────────────────

    fun findDeveloperOptionsMasterSwitch(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        val keywords = profile.devOptionsLabels
        val candidateNodes = mutableListOf<AccessibilityNodeInfo>()
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.addLast(root to 0)
        val maxVisited = 1200
        var visited = 0

        while (queue.isNotEmpty() && visited < maxVisited) {
            val (node, depth) = queue.removeFirst()
            visited++
            if (depth > 8) { if (node !== root) node.recycle(); continue }

            val className = node.className?.toString() ?: ""
            val isEditText = className.contains("EditText", ignoreCase = true)
            val text = node.text?.toString()
            val contentDesc = node.contentDescription?.toString()
            val matched = !isEditText && node !== root && (
                (text != null && keywords.any { kw -> text.contains(kw, ignoreCase = true) }) ||
                    (contentDesc != null && keywords.any { kw -> contentDesc.contains(kw, ignoreCase = true) })
                )
            if (matched) {
                candidateNodes.add(node)
            } else {
                if (node !== root) node.recycle()
            }
            if (depth < 8) {
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { queue.addLast(it to (depth + 1)) }
                }
            }
        }

        var bestSw: AccessibilityNodeInfo? = null
        var bestTop = Int.MAX_VALUE

        for (labelNode in candidateNodes) {
            var foundSw: AccessibilityNodeInfo? = null
            try {
                var row: AccessibilityNodeInfo? = labelNode.parent
                repeat(8) {
                    val p = row ?: return@repeat
                    foundSw = findSwitchInSubtree(p)
                    if (foundSw != null) return@repeat
                    val next = p.parent
                    p.recycle()
                    row = next
                }
            } finally {
                labelNode.recycle()
            }
            val sw = foundSw ?: continue
            val r = Rect()
            sw.getBoundsInScreen(r)
            if (r.top < bestTop) {
                bestSw?.recycle()
                bestSw = sw
                bestTop = r.top
            } else {
                sw.recycle()
            }
        }
        return bestSw
    }

    // ── 开关搜索 ──────────────────────────────────────────────────

    /** 从 label 节点向上搜索 Switch/ToggleButton */
    fun findWirelessDebugSwitch(
        root: AccessibilityNodeInfo,
        profile: RomProfile
    ): AccessibilityNodeInfo? {
        val labelNode = findWirelessDebugEntryNode(root, profile) ?: return null
        var current: AccessibilityNodeInfo? = labelNode
        val ownedParents = mutableListOf<AccessibilityNodeInfo>()
        for (i in 0 until 4) {
            val p = current?.parent ?: break
            ownedParents += p
            current = p
            val sw = findSwitchInSubtree(p)
            if (sw != null) {
                if (sw !== labelNode) labelNode.recycle()
                ownedParents.filter { it !== sw }.forEach { it.recycle() }
                return sw
            }
        }
        ownedParents.forEach { it.recycle() }
        return labelNode
    }

    /** 在子树中查找 Switch 或 ToggleButton */
    fun findSwitchInSubtree(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val cn = node.className?.toString() ?: ""
        if (cn.contains("Switch") || cn.contains("ToggleButton") || node.isCheckable) return node
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        for (i in 0 until node.childCount) node.getChild(i)?.let { stack.addLast(it) }
        while (stack.isNotEmpty()) {
            val current = stack.removeLast()
            val currentCn = current.className?.toString() ?: ""
            if (currentCn.contains("Switch") || currentCn.contains("ToggleButton") || current.isCheckable) {
                while (stack.isNotEmpty()) stack.removeLast().recycle()
                return current
            }
            for (i in 0 until current.childCount) current.getChild(i)?.let { stack.addLast(it) }
            current.recycle()
        }
        return null
    }

    // ── 搜索框 ────────────────────────────────────────────────────

    fun findSearchBox(root: AccessibilityNodeInfo, profile: RomProfile): AccessibilityNodeInfo? {
        // 优先用资源 ID
        findByResourceIds(root, profile.searchBoxResourceIds)?.let { return it }
        // 回退文本匹配
        for (hint in profile.searchHints) {
            val nodes = root.findAccessibilityNodeInfosByText(hint)
            var target: AccessibilityNodeInfo? = null
            for (n in nodes) {
                if (n.className?.toString()?.contains("EditText") == true) {
                    target = n; break
                }
                var p: AccessibilityNodeInfo? = n.parent
                val tempParents = mutableListOf<AccessibilityNodeInfo>()
                for (depth in 0 until 3) {
                    val parent = p ?: break
                    tempParents += parent
                    if (parent.className?.toString()?.contains("EditText") == true) {
                        target = parent; break
                    }
                    p = parent.parent
                }
                if (target == null) tempParents.forEach { it.recycle() }
                else { tempParents.filter { it !== target }.forEach { it.recycle() }; break }
            }
            nodes.filter { it !== target }.forEach { it.recycle() }
            if (target != null) return target
        }
        return null
    }

    // ── 开关状态判断（R-3）────────────────────────────────────────

    /**
     * R-3: 优先以 isChecked 为准，降级到 contentDescription 字符串匹配时记录命中路径。
     */
    fun isEnabled(node: AccessibilityNodeInfo, profile: RomProfile): Boolean {
        if (node.isChecked) {
            Log.d(TAG, "isEnabled: matched via isChecked=true")
            return true
        }
        val desc = node.contentDescription?.toString() ?: ""
        if (desc.isNotEmpty()) {
            val d = desc.trim()
            val matched = profile.enabledDescriptions.any { desc.contains(it) } ||
                d.equals("on", ignoreCase = true) ||
                d.endsWith(" on", ignoreCase = true)
            if (matched) {
                Log.d(TAG, "isEnabled: matched via node contentDescription='$desc'")
                return true
            }
        }
        val parent = node.parent ?: run {
            Log.d(TAG, "isEnabled: no parent, returning false (isChecked=false desc='$desc')")
            return false
        }
        return try {
            val parentDesc = parent.contentDescription?.toString() ?: ""
            val matched = profile.enabledDescriptions.any { parentDesc.contains(it) }
            if (matched) {
                Log.d(TAG, "isEnabled: matched via parent contentDescription='$parentDesc'")
            } else {
                Log.d(TAG, "isEnabled: all checks failed (isChecked=false desc='$desc' parentDesc='$parentDesc')")
            }
            matched
        } finally {
            parent.recycle()
        }
    }

    // ── 通用 BFS ──────────────────────────────────────────────────

    /**
     * 通用 BFS 遍历，返回第一个满足 predicate 的最佳候选节点。
     * predicate 应检查节点属性但不 recycle（由此方法管理）。
     * 返回的候选节点中，选可点击 + 屏幕位置最高的节点。
     */
    fun findByTreeBfs(
        root: AccessibilityNodeInfo,
        maxVisited: Int = 1500,
        maxDepth: Int = 10,
        predicate: (AccessibilityNodeInfo) -> Boolean
    ): AccessibilityNodeInfo? {
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.addLast(root to 0)
        val candidates = mutableListOf<AccessibilityNodeInfo>()
        var visited = 0

        while (queue.isNotEmpty() && visited < maxVisited) {
            val (node, depth) = queue.removeFirst()
            visited++
            if (depth > maxDepth) { if (node !== root) node.recycle(); continue }

            if (node !== root && predicate(node)) {
                candidates.add(node)
            } else {
                if (node !== root) node.recycle()
            }

            if (depth < maxDepth) {
                for (i in 0 until node.childCount) {
                    node.getChild(i)?.let { queue.addLast(it to (depth + 1)) }
                }
            }
        }

        if (candidates.isEmpty()) return null

        var best: AccessibilityNodeInfo? = null
        var bestScore = Long.MAX_VALUE
        for (n in candidates) {
            val clickable = n.isClickable && n.isEnabled && n.isVisibleToUser
            val prio = if (clickable) 0L else 1L
            val r = Rect()
            n.getBoundsInScreen(r)
            val score = prio * 1_000_000L + r.top.toLong()
            if (score < bestScore) {
                best?.recycle()
                best = n
                bestScore = score
            } else {
                n.recycle()
            }
        }
        return best
    }

    // ── 弹窗检测 ──────────────────────────────────────────────────

    fun isPairingDialogPresent(root: AccessibilityNodeInfo, profile: RomProfile): Boolean =
        hasAnyText(root, profile.pairingDialogKeywords)

    // ── 工具方法 ──────────────────────────────────────────────────

    fun recycleDistinct(vararg nodes: AccessibilityNodeInfo?) {
        val seen = HashSet<Int>()
        for (node in nodes) {
            if (node == null) continue
            val id = System.identityHashCode(node)
            if (seen.add(id)) node.recycle()
        }
    }
}
