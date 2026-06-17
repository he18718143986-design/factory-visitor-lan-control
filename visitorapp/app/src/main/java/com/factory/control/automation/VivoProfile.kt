package com.factory.control.automation

/**
 * VivoProfile — vivo OriginOS / Funtouch OS 适配
 *
 * vivo 设备 Settings 包名为 com.android.settings 或 com.vivo.settings。
 * OriginOS 的开发者选项入口：「关于手机」→ 连续点击「软件版本号」。
 * 无线调试在开发者选项中，一般标注为「无线调试」或「WLAN 调试」。
 */
object VivoProfile : RomProfile by AospProfile {

    override val settingsPackage = "com.android.settings"

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.vivo.settings:id/title",
        "com.vivo.settings:id/action_bar_title",
        "com.bbk.settings:id/title"
    )

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.vivo.settings:id/search_src_text",
        "com.bbk.settings:id/search_src_text"
    )

    override val switchWidgetResourceIds = AospProfile.switchWidgetResourceIds + listOf(
        "com.vivo.settings:id/switch_widget",
        "com.bbk.settings:id/switch_widget"
    )

    override val aboutPhoneLabels = listOf(
        "关于手机", "关于设备", "About phone", "About device",
        "我的手机", "本机信息"
    )

    override val buildNumberLabels = listOf(
        "软件版本号", "版本号", "Build number", "软件版本",
        "版本信息"
    )

    override val devOptionsLabels = AospProfile.devOptionsLabels + listOf(
        "开发者选项", "系统管理"
    )

    override val wirelessDebugLabels = AospProfile.wirelessDebugLabels + listOf(
        "无线调试", "WLAN 调试", "WLAN调试"
    )

    override val enabledDescriptions = AospProfile.enabledDescriptions + listOf(
        "开启", "打开", "已打开"
    )

    override fun dialogConfirmLabels(stage: String): List<String> = when (stage) {
        "CLICKING_BUILD_NUMBER" -> listOf("确定", "OK", "我知道了", "知道了", "好的")
        "OPENING_WIRELESS_DEBUG", "ENABLING_SWITCH" -> listOf("允许", "Allow", "确定", "OK", "同意", "开启")
        "OPENING_QR_PAIRING" -> listOf("允许", "确定", "OK")
        else -> emptyList()
    }

    override val pinTitleHints = AospProfile.pinTitleHints + listOf(
        "请输入密码", "请输入锁屏密码", "锁屏密码"
    )

    override val pinTextHints = AospProfile.pinTextHints + listOf(
        "密码", "请输入锁屏密码", "请输入密码"
    )

    override val needOneMoreTapHints = AospProfile.needOneMoreTapHints + listOf(
        "您已处于开发者模式", "已开启开发者模式",
        "You are now a developer"
    )
}
