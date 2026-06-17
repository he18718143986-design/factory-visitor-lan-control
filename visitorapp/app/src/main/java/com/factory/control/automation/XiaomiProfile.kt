package com.factory.control.automation

/**
 * XiaomiProfile — 小米 MIUI / HyperOS 适配
 *
 * 小米设备 Settings 包名为 com.android.settings 但 Build.MANUFACTURER = "Xiaomi"。
 * MIUI 的开发者选项嵌套在「我的设备」→「全部参数与信息」→ 连续点击「MIUI 版本」。
 * 无线调试在 MIUI 中一般标注为「无线调试」或「WLAN 调试」。
 */
object XiaomiProfile : RomProfile by AospProfile {

    override val settingsPackage = "com.android.settings"

    override val titleResourceIds = AospProfile.titleResourceIds + listOf(
        "com.android.settings:id/toolbar_title",
        "com.miui.settings:id/title",
        "com.miui.settings:id/action_bar_title"
    )

    override val searchBoxResourceIds = AospProfile.searchBoxResourceIds + listOf(
        "com.android.settings:id/search_bar",
        "com.android.settings:id/search_bar_text"
    )

    override val switchWidgetResourceIds = AospProfile.switchWidgetResourceIds + listOf(
        "com.android.settings:id/switchWidget",
        "android:id/checkbox"
    )

    override val aboutPhoneLabels = listOf(
        "关于手机", "我的设备", "About phone", "My device",
        "全部参数", "全部参数与信息", "All specs"
    )

    override val buildNumberLabels = listOf(
        "MIUI 版本", "MIUI版本", "HyperOS 版本", "HyperOS版本",
        "版本号", "Build number", "内部版本号", "OS version"
    )

    override val devOptionsLabels = AospProfile.devOptionsLabels + listOf(
        "开发者选项", "更多设置"
    )

    override val wirelessDebugLabels = AospProfile.wirelessDebugLabels + listOf(
        "WLAN 调试", "WLAN调试", "Wireless debugging (WLAN)"
    )

    override val enabledDescriptions = AospProfile.enabledDescriptions + listOf(
        "开", "打开"
    )

    override fun dialogConfirmLabels(stage: String): List<String> = when (stage) {
        "CLICKING_BUILD_NUMBER" -> listOf("确定", "OK", "知道了", "我知道了")
        "OPENING_WIRELESS_DEBUG", "ENABLING_SWITCH" -> listOf("允许", "Allow", "确定", "OK", "同意")
        "OPENING_QR_PAIRING" -> listOf("允许", "Allow", "确定")
        else -> emptyList()
    }

    override val pinTitleHints = AospProfile.pinTitleHints + listOf(
        "输入锁屏密码", "验证身份", "请输入密码"
    )

    override val pinTextHints = AospProfile.pinTextHints + listOf(
        "请输入锁屏密码", "输入锁屏密码", "密码", "图案"
    )

    override val needOneMoreTapHints = AospProfile.needOneMoreTapHints + listOf(
        "您已处于开发者模式", "再按", "再点击",
        "您现在已处于开发者模式", "You are now a developer"
    )
}
