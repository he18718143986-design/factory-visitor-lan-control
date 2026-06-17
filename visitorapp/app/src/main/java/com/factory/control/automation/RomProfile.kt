@file:Suppress("DEPRECATION")
package com.factory.control.automation

/**
 * RomProfile — ROM 适配层
 *
 * 将 78 处中文/英文 UI 字符串收拢到一个可替换接口中，
 * 各方法同时提供「资源 ID 优先」和「文本回退」两组标识。
 *
 * 使用方式：
 *   val profile = RomProfile.detect(settingsPackageName)
 *   val node = NodeFinder.findPrefer(root, profile.titleResourceIds, profile.aboutPhoneLabels)
 */
interface RomProfile {

    /** Settings app 包名 */
    val settingsPackage: String

    // ── 资源 ID 列表 ──────────────────────────────────────────────

    /** 页面标题 resource-id（Action Bar / Toolbar 标题） */
    val titleResourceIds: List<String>

    /** 搜索框 resource-id */
    val searchBoxResourceIds: List<String>

    /** 开关控件 resource-id（Switch / SwitchCompat） */
    val switchWidgetResourceIds: List<String>

    // ── 文本标签列表（文本回退匹配） ──────────────────────────────

    /** 「关于手机」入口文案 */
    val aboutPhoneLabels: List<String>

    /** 「版本号」文案 */
    val buildNumberLabels: List<String>

    /** 「开发者选项」入口文案（包含匹配） */
    val devOptionsLabels: List<String>

    /** 「USB 调试」文案 — 用于识别是否在开发者选项页 */
    val usbDebugLabels: List<String>

    /**
     * 「无线调试」入口文案。
     * 包含大量 ROM 差异变体（无线调试 / WLAN 调试 / Wi-Fi 调试 / ADB 无线调试 等）
     */
    val wirelessDebugLabels: List<String>

    /** 「无线调试」分词匹配 — 前缀标记（"无线"/"WLAN"/"Wi-Fi" 等） */
    val wirelessTokens: List<String>

    /** 「无线调试」分词匹配 — 后缀标记（"调试"/"debug" 等） */
    val debugTokens: List<String>

    /** 「使用二维码配对」入口文案 */
    val qrPairingLabels: List<String>

    /** 配对弹窗中的关键词（「扫描二维码」/「配对设备」） */
    val pairingDialogKeywords: List<String>

    /** 无线调试详情页关键词（「配对码」/「二维码」） */
    val wirelessDetailKeywords: List<String>

    /** 开关 contentDescription 开启状态标记 */
    val enabledDescriptions: List<String>

    /** PIN / 密码验证页标题提示 */
    val pinTitleHints: List<String>

    /** PIN / 密码验证页输入框提示 */
    val pinTextHints: List<String>

    /** 弹窗确认按钮在各阶段的文案 */
    fun dialogConfirmLabels(stage: String): List<String>

    /** 搜索按钮/提示文案 */
    val searchHints: List<String>

    /** 「再点击一次版本号」提示 */
    val needOneMoreTapHints: List<String>

    /** 无线调试页面标题命中词 */
    val wirelessDebugTitleKeywords: List<String>

    /** 关于手机页面标题命中词 */
    val aboutPageTitleKeywords: List<String>

    /** 开发者选项页面标题命中词 */
    val devOptionsTitleKeywords: List<String>

    companion object {
        /**
         * 根据 Settings app 包名 + 设备厂商自动选择 ROM Profile。
         * 运行时在首次获取 root window 时调用。
         */
        fun detect(packageName: String): RomProfile {
            // 先按 Settings 包名匹配
            return when {
                packageName.contains("huawei", ignoreCase = true) -> HuaweiProfile
                packageName.contains("hihonor", ignoreCase = true) -> HonorProfile
                packageName.contains("coloros", ignoreCase = true) -> OppoProfile
                packageName.contains("oplus", ignoreCase = true) -> OppoProfile
                packageName.contains("vivo", ignoreCase = true) -> VivoProfile
                packageName.contains("bbk", ignoreCase = true) -> VivoProfile
                packageName.contains("miui", ignoreCase = true) -> XiaomiProfile
                packageName.contains("samsung", ignoreCase = true) -> SamsungProfile
                else -> {
                    // 包名无法区分时，按 Build.MANUFACTURER 回退
                    val mfr = android.os.Build.MANUFACTURER.lowercase()
                    when {
                        mfr.contains("samsung") -> SamsungProfile
                        mfr.contains("xiaomi") || mfr.contains("redmi") || mfr.contains("poco") -> XiaomiProfile
                        mfr.contains("oppo") || mfr.contains("realme") || mfr.contains("oneplus") -> OppoProfile
                        mfr.contains("vivo") || mfr.contains("iqoo") -> VivoProfile
                        else -> AospProfile
                    }
                }
            }
        }
    }
}

// ─── AOSP Profile ────────────────────────────────────────────────

object AospProfile : RomProfile {
    override val settingsPackage = "com.android.settings"

    override val titleResourceIds = listOf(
        "android:id/title",
        "com.android.settings:id/title",
        "android:id/action_bar_title",
        "com.android.settings:id/action_bar_title"
    )

    override val searchBoxResourceIds = listOf(
        "com.android.settings:id/search_action_bar",
        "com.android.settings:id/search_src_text",
        "android:id/search_src_text",
        "com.android.settings:id/search_box"
    )

    override val switchWidgetResourceIds = listOf(
        "android:id/switch_widget",
        "android:id/switchWidget",
        "com.android.settings:id/switch_widget",
        "com.android.settings:id/switch_bar"
    )

    override val aboutPhoneLabels = listOf(
        "关于手机", "关于设备", "About phone", "About device", "My device", "我的设备"
    )

    override val buildNumberLabels = listOf(
        "版本号", "Build number", "版本信息"
    )

    override val devOptionsLabels = listOf(
        "开发者选项", "开发人员选项", "开发人员设置",
        "Developer options", "Development settings",
        "Use developer options", "使用开发者选项"
    )

    override val usbDebugLabels = listOf(
        "USB 调试", "USB调试", "USB debugging"
    )

    override val wirelessDebugLabels = listOf(
        "无线调试", "Wireless debugging", "WLAN 调试", "WLAN debugging",
        "Wi-Fi 调试", "WiFi 调试", "Wi\u2011Fi 调试",
        "无线调试 (Wi-Fi)", "Wireless debugging (Wi-Fi)",
        "Wi-Fi debugging", "WiFi debugging", "Wi\u2011Fi debugging",
        "ADB 无线调试", "无线调试（ADB）", "ADB over Wi-Fi", "ADB over WiFi",
        "无线 ADB 调试", "无线ADB调试", "无线调试（安全）", "无线调试（安全设置）",
        "Wireless ADB debugging", "ADB wireless debugging"
    )

    override val wirelessTokens = listOf("无线", "WLAN", "Wi-Fi", "WiFi")
    override val debugTokens = listOf("调试", "debug")

    override val qrPairingLabels = listOf(
        "使用二维码配对", "Pair device with QR code", "二维码配对"
    )

    override val pairingDialogKeywords = listOf(
        "扫描二维码", "Scan QR code", "配对设备", "Pair device"
    )

    override val wirelessDetailKeywords = listOf(
        "配对码", "pairing code", "二维码", "QR code"
    )

    override val enabledDescriptions = listOf(
        "已开启", "已启用", " ON", "Enabled", "enabled"
    )

    override val pinTitleHints = listOf(
        "输入密码", "验证", "安全验证", "Verify", "Password", "PIN"
    )

    override val pinTextHints = listOf(
        "输入 PIN", "输入密码", "确认密码", "请输入锁屏密码", "PIN", "Password"
    )

    override fun dialogConfirmLabels(stage: String): List<String> = when (stage) {
        "CLICKING_BUILD_NUMBER" -> listOf("确定", "OK")
        "OPENING_WIRELESS_DEBUG", "ENABLING_SWITCH" -> listOf("允许", "Allow", "开启", "Enable", "确定")
        "OPENING_QR_PAIRING" -> listOf("允许", "Allow", "确定")
        else -> emptyList()
    }

    override val searchHints = listOf("搜索", "Search", "搜索设置", "搜索设置项")

    override val needOneMoreTapHints = listOf(
        "再点击一次版本号", "再点一次版本号", "再点击一次",
        "还需一步", "还差一步", "One step away", "one more step"
    )

    override val wirelessDebugTitleKeywords = listOf("无线调试", "Wireless debugging", "WLAN 调试")

    override val aboutPageTitleKeywords = listOf(
        "关于", "About", "手机", "设备", "Device", "本机", "Info", "信息"
    )

    override val devOptionsTitleKeywords = listOf(
        "开发者选项", "开发人员选项", "开发人员设置",
        "Developer options", "Development settings"
    )
}

// ─── Huawei Profile ──────────────────────────────────────────────

object HuaweiProfile : RomProfile by AospProfile {
    override val settingsPackage = "com.huawei.android.settings"

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.huawei.android.settings:id/search_src_text"
    )

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.huawei.android.settings:id/title",
        "com.huawei.android.settings:id/action_bar_title"
    )
}

// ─── Honor Profile ───────────────────────────────────────────────

object HonorProfile : RomProfile by AospProfile {
    override val settingsPackage = "com.hihonor.android.settings"

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.hihonor.android.settings:id/search_src_text"
    )

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.hihonor.android.settings:id/title",
        "com.hihonor.android.settings:id/action_bar_title"
    )
}
