package com.factory.control.automation

/**
 * OppoProfile — OPPO ColorOS 适配
 *
 * OPPO 设备 Settings 包名为 com.android.settings 或 com.coloros.settings。
 * ColorOS 的开发者选项入口：「关于手机」→ 连续点击「版本号」。
 * 无线调试一般在「开发者选项」→「无线调试」。
 */
object OppoProfile : RomProfile by AospProfile {

    override val settingsPackage = "com.android.settings"

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.coloros.settings:id/title",
        "com.coloros.settings:id/action_bar_title",
        "com.oplus.settings:id/title"
    )

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.coloros.settings:id/search_src_text",
        "com.oplus.settings:id/search_src_text"
    )

    override val switchWidgetResourceIds = AospProfile.switchWidgetResourceIds + listOf(
        "com.coloros.settings:id/switch_widget",
        "com.oplus.settings:id/switch_widget"
    )

    override val aboutPhoneLabels = listOf(
        "关于手机", "关于本机", "关于设备", "About phone", "About device",
        "手机信息"
    )

    override val buildNumberLabels = listOf(
        "版本号", "Build number", "软件版本", "版本信息",
        "ColorOS 版本", "ColorOS版本"
    )

    override val devOptionsLabels = AospProfile.devOptionsLabels + listOf(
        "开发者选项", "其他设置"
    )

    override val wirelessDebugLabels = AospProfile.wirelessDebugLabels + listOf(
        "无线调试", "Wireless debugging"
    )

    override val enabledDescriptions = AospProfile.enabledDescriptions + listOf(
        "开启", "打开", "已打开"
    )

    override fun dialogConfirmLabels(stage: String): List<String> = when (stage) {
        "CLICKING_BUILD_NUMBER" -> listOf("确定", "OK", "我知道了", "知道了")
        "OPENING_WIRELESS_DEBUG", "ENABLING_SWITCH" -> listOf("允许", "Allow", "确定", "OK", "开启")
        "OPENING_QR_PAIRING" -> listOf("允许", "确定")
        else -> emptyList()
    }

    override val pinTitleHints = AospProfile.pinTitleHints + listOf(
        "请输入密码", "验证密码", "锁屏密码验证"
    )

    override val pinTextHints = AospProfile.pinTextHints + listOf(
        "密码", "请输入锁屏密码"
    )

    override val needOneMoreTapHints = AospProfile.needOneMoreTapHints + listOf(
        "您已处于开发者模式", "You are now a developer"
    )
}
