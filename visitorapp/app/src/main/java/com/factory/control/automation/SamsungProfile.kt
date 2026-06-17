package com.factory.control.automation

/**
 * SamsungProfile — Samsung One UI 适配
 *
 * Samsung 设备 Settings 包名为 com.android.settings（与 AOSP 相同），
 * 但 Build.MANUFACTURER = "samsung"。
 * One UI 的开发者选项入口：「关于手机」→「软件信息」→ 连续点击「编译编号」。
 * 无线调试在开发者选项中，一般标注为「无线调试」或「Wireless debugging」。
 */
object SamsungProfile : RomProfile by AospProfile {

    override val settingsPackage = "com.android.settings"

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.samsung.android.settings:id/title",
        "com.samsung.android.settings:id/action_bar_title",
        "com.sec.android.app.launcher:id/title"
    )

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.samsung.android.settings:id/search_src_text",
        "com.samsung.android.settings:id/search_action_bar"
    )

    override val switchWidgetResourceIds = AospProfile.switchWidgetResourceIds + listOf(
        "com.samsung.android.settings:id/switch_widget",
        "com.samsung.android.settings:id/switch_bar"
    )

    override val aboutPhoneLabels = listOf(
        "关于手机", "关于设备", "About phone", "About device",
        "软件信息", "Software information"
    )

    override val buildNumberLabels = listOf(
        "编译编号", "版本号", "Build number", "软件版本",
        "基带版本", "内核版本"
    )

    override val devOptionsLabels = AospProfile.devOptionsLabels + listOf(
        "开发者选项", "开发人员选项"
    )

    override val wirelessDebugLabels = AospProfile.wirelessDebugLabels + listOf(
        "无线调试", "Wireless debugging"
    )

    override val enabledDescriptions = AospProfile.enabledDescriptions + listOf(
        "开启", "打开", "已打开"
    )

    override fun dialogConfirmLabels(stage: String): List<String> = when (stage) {
        "CLICKING_BUILD_NUMBER" -> listOf("确定", "OK", "知道了")
        "OPENING_WIRELESS_DEBUG", "ENABLING_SWITCH" -> listOf("允许", "Allow", "确定", "OK")
        "OPENING_QR_PAIRING" -> listOf("允许", "确定", "OK")
        else -> emptyList()
    }

    override val pinTitleHints = AospProfile.pinTitleHints + listOf(
        "请输入密码", "验证身份", "输入锁屏密码", "确认您的 PIN"
    )

    override val pinTextHints = AospProfile.pinTextHints + listOf(
        "密码", "请输入锁屏密码", "图案"
    )

    override val needOneMoreTapHints = AospProfile.needOneMoreTapHints + listOf(
        "您已处于开发者模式", "You are now a developer",
        "开发者模式已启用", "Developer mode has been enabled"
    )

    override val aboutPageTitleKeywords = AospProfile.aboutPageTitleKeywords + listOf(
        "软件信息", "Software information"
    )
}
