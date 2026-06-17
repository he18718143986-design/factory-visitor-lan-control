# Phase 3: Release Validation — E2E 验证方案

> 日期: 2026-04-10 (最后更新: B-1/B-2/B-3 修复后)  
> 范围: factory-saas + visitorapp 全链路  
> 目标: 判定系统是否达到商业交付标准

---

## 〇、阻断问题清单 (Blockers)

| # | 严重度 | 状态 | 问题 | 影响范围 | 修复方案 |
|---|--------|------|------|----------|----------|
| **B-1** | **🔴 P0** | ✅ 已修复 | CSRF 中间件阻断 Android 端 POST 请求 | `POST /api/checkin`、`POST /api/sessions/:id/device`、`POST /api/sessions/:id/exit` 均被全局 `csrfProtection` 拦截 | `middleware/csrf.js` 新增 `CSRF_EXEMPT_PATTERNS` 白名单，4 条正则匹配自带独立验证的端点。csrf-exempt.test.js 集成测试验证 |
| **B-2** | **🔴 P0** | ✅ 已修复 | CSRF 中间件阻断支付宝异步回调 | `POST /api/payment/notify` 来自支付宝服务器 (form-urlencoded, 无 cookie) → 403 | 同 B-1 白名单覆盖 `/api/payment/notify`。该端点自带 RSA2 签名验证 |
| **B-3** | **🟡 P1** | ✅ 已修复 | `POST /api/checkin` 被 Android 端调用却无 CSRF 适配 | `MainActivity.kt:795` 直接 POST → 被拦截 | 同 B-1 白名单覆盖 `/api/checkin`。该端点自带 checkinToken HMAC-SHA256 签名验证 |
| **B-4** | **🟡 P1** | ⏳ 待验证 | `alipay-sdk` 未做沙箱集成验证 | `routes/payment.js` 存在懒加载 alipay-sdk，但无测试覆盖沙箱环境。`exec('alipay.trade.wap.pay')` 的返回值格式可能因 SDK 版本变化 | 需用支付宝沙箱 appId + privateKey 做至少一次真实调用 |

---

## 一、E2E 用例矩阵

### 场景 1: 用户注册 → 登录

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 1.1 | 注册新用户 | `POST /api/auth/register` | 200, `success: true`, cookie 中包含 JWT token | email 格式校验、password < 8、email 重复 (409) |
| 1.2 | 验证自动创建 site + trial 订阅 | `GET /api/sites` | 至少 1 个 site，subscription.status === 'trial'，remainingDays ≈ 7 | `createSiteWithTrialSubscription` 事务失败 |
| 1.3 | 登出 | `POST /api/auth/logout` | 200, JWT cookie 被清除 | — |
| 1.4 | 用已注册凭据登录 | `POST /api/auth/login` | 200, `user.email` 匹配, `redirect` 为 '/dashboard' | bcrypt 比对失败 |
| 1.5 | 验证已登录状态 | `GET /api/auth/me` | 200, 返回用户信息 | JWT 过期 / secret 不匹配 |
| 1.6 | 错误密码登录 | `POST /api/auth/login` (wrong pwd) | 401 INVALID_CREDENTIALS | — |
| 1.7 | 重复注册同邮箱 | `POST /api/auth/register` (same email) | 409 EMAIL_TAKEN | — |
| 1.8 | 登录频率限制 | 连续 N 次错误登录 | 429 RATE_LIMITED | 限流窗口配置不当 |

**自动化方式**: Node.js — `supertest` + `jest`  
**现有覆盖**: auth-flow.test.js 覆盖 1.1/1.4/1.5/1.6/1.7 ✅ | 1.2/1.3/1.8 ❌ 缺失  
**是否可商业交付**: ✅ 核心流程可用

---

### 场景 2: 创建 Site → 配置 WiFi

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 2.1 | 创建新厂区 | `POST /api/sites` | 200, 返回 siteId + subscriptionId | 重复厂区名未处理 |
| 2.2 | 获取厂区列表 | `GET /api/sites` | 包含新创建的 site，带 trial subscription | DB 查询失败 |
| 2.3 | 配置 WiFi SSID/密码 | `PUT /api/user/subscriptions/:subId/wifi` | 200, wifi_ssid/wifi_password 已更新 | 字段长度超限 (ssid≤64, pwd≤128) |
| 2.4 | 绑定当前 IP 网段 | `POST /api/user/subscriptions/:subId/bind-ip` | 200, 返回 wifiSubnet (CIDR) | 服务器在公网 / 无法推断子网 |
| 2.5 | 配置功能开关 | `PUT /api/user/subscriptions/:subId/features` | camera/screenshot 状态变更 | — |
| 2.6 | 验证绑定后生效 | `GET /api/checkin-qr?siteId=...` | 200, 返回 QR + token | 网段不匹配 → 403 NETWORK_NOT_ALLOWED |
| 2.7 | 在不同网段请求 QR | `GET /api/checkin-qr` (from diff subnet) | 403 NETWORK_NOT_ALLOWED | 首次绑定 auto-bootstrap 可能绕过 |

**自动化方式**: Node.js — `supertest`  
**现有覆盖**: 无专项测试 ❌  
**是否可商业交付**: ⚠️ 需补全 2.3-2.7 验证

---

### 场景 3: Visitor Checkin → deviceToken 生成

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 3.1 | 管理员生成 QR | `GET /api/checkin-qr?siteId=...` | 返回 qr (base64 PNG), checkinToken, url | 订阅过期 → 402 |
| 3.2 | 访客通过 QR URL 进入 | `GET /api/checkin-start?...` | 302 → /welcome?... | token 格式错误 |
| 3.3 | 访客提交签到 | `POST /api/checkin` | 200, sessionId (uuid), deviceToken (32 hex), entryQR, exitQR | ~~B-1/B-3: CSRF 拦截~~ ✅ 已修复；token 过期；网段不匹配 |
| 3.4 | 验证 sessionId 唯一 | 两次不同 visitor 签到 | 不同 sessionId | — |
| 3.5 | 验证幂等 | 同 IP + 同 token 5 分钟内再签 | 返回相同 sessionId + deviceToken | IP 检测偏差 |
| 3.6 | 签到 token 过期 | 使用 >10 分钟前的 token | 403 TOKEN_EXPIRED | 时钟偏移 |
| 3.7 | 签到 token 篡改 | 修改 token 内容 | 403 INVALID_TOKEN | — |
| 3.8 | 获取公开站点特性 | `GET /api/site-features?siteId=...` | 不包含 wifiSsid/wifiPassword | 信息泄漏 |

**自动化方式**: Node.js — `supertest`  
**现有覆盖**: checkin-flow.test.js 覆盖 3.3(部分)/3.5/3.7 ✅ | checkin-features.test.js 覆盖 3.8 ✅  
**是否可商业交付**: ✅ B-1/B-3 已修复，Android 端签到畅通

---

### 场景 4: Android Device 上报 + ADB Pairing

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 4.1 | App 上报 deviceIp | `POST /api/sessions/:id/device` | 200, session.deviceIp 已更新 | ~~B-1: CSRF 拦截~~ ✅ 已修复；非私有 IP → 400 |
| 4.2 | 无效 deviceToken | `POST /api/sessions/:id/device` (bad token) | 401 INVALID_DEVICE_TOKEN | — |
| 4.3 | 公网 IP 拒绝 | `POST /api/sessions/:id/device` (public IP) | 400 INVALID_DEVICE_IP | — |
| 4.4 | mDNS 配对广播 | 设备端 NsdManager | 服务器 `mdns.waitForPairing()` 检测到设备 | ADB daemon 未启动; 端口冲突 |
| 4.5 | ADB pair 执行 | `adb pair host:port password` | 配对成功, 返回 GUID | adb 二进制不存在 (execFile); 配对超时 |
| 4.6 | ADB connect 建立 | `adb connect host:5555` | 设备出现在 `adb devices` | 防火墙拦截; WiFi 隔离 |
| 4.7 | Restriction 生效 | `applyRestrictions(deviceId)` | camera appops 禁用; 屏幕截图禁用; 指定 app 冻结 | 设备不支持 appops; DPM 权限不足 |
| 4.8 | Session 状态变迁 | WebSocket event | status: waiting → pairing → restricted | 事件丢失; WS 连接断开 |

**自动化方式**:
- 4.1-4.3: Node.js — `supertest` (已有 device-token.test.js)
- 4.4-4.8: **需真机/模拟器** — `adb` CLI 脚本 + Android Instrumented Test (Espresso / UI Automator)

**现有覆盖**: device-token.test.js 覆盖 4.1-4.3 ✅ | 4.4-4.8 无覆盖 ❌  
**是否可商业交付**: ⚠️ B-1 已修复 ✅; 真机流程需手动验收

---

### 场景 5: WebSocket 实时通信

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 5.1 | 管理员 WS 连接 | `ws://host:port/?siteId=...` (with JWT cookie) | connection open; 收到已有 session 列表 | JWT 验证失败; Origin 校验拒绝 |
| 5.2 | 访客 WS 连接 | `ws://host:port/?sessionId=...&dt=...` | connection open; 收到 init event | deviceToken 不匹配 → close |
| 5.3 | Session 状态广播 | 触发 status 变更 | 所有订阅者收到 `sessionUpdate` 事件 | 事件漏发; Room 路由错误 |
| 5.4 | 事件持久化 | 检查 ws_events 表 | 关键事件 (sessionCreated, tamperAlert) 已存储 | SQLite 写入失败 |
| 5.5 | 断线重连 + 回放 | WS 断开 → 带 lastEventId 重连 | 收到断线期间的所有持久事件 (_replay=true) | 事件已被 24h 清理 |
| 5.6 | Tamper 警报推送 | 巡检发现篡改 | 收到 `tamperAlert` + tamperDetails | 巡检间隔过长导致延迟 |
| 5.7 | 并发连接 | 多个 admin 同时订阅 | 所有连接收到相同事件 | 内存泄漏; 广播遗漏 |

**自动化方式**: Node.js — `ws` 库 + `jest`（创建 WS 客户端连接本地服务器）  
**现有覆盖**: 无 ❌  
**是否可商业交付**: ⚠️ 核心实时功能无测试覆盖，需补充

---

### 场景 6: Visitor Exit 流程

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 6.1 | 访客扫描 exit QR | App 解析 JSON: `{type:"exit", sessionId, exitToken, serverUrl}` | 正确解析, 进入 EXITING 状态 | QR 格式变更 |
| 6.2 | App POST 离场 | `POST /api/sessions/:id/exit` | 200, success: true | ~~B-1: CSRF 拦截~~ ✅ 已修复；exitToken 不匹配 → 403 |
| 6.3 | 验证限制解除 | ADB: `adb shell appops get ...` | camera/screenshot 权限恢复 | adb disconnect 先于解除 |
| 6.4 | 篡改检测 | `verifyRestrictions()` | tamperDetected 和 verifyReport 正确表示 | appops 查询兼容性 |
| 6.5 | Session 状态流转 | WebSocket event | status: restricted → exiting → exited | 异步竞争; 双重 exit |
| 6.6 | 重复 exit | 再次 POST 同 session exit | 409 ALREADY_EXITED | — |
| 6.7 | 管理员强制离场 | `POST /api/sessions/:id/force-exit` | 200, session 变为 exited | 设备已断连 |
| 6.8 | 已完成 session 清理 | 等待 `sessionExitedCleanMs` | session 从内存移除 | 计时器精度 |

**自动化方式**:
- 6.2/6.6/6.7: Node.js — `supertest`
- 6.1/6.3/6.4: Android Instrumented Test + ADB 脚本
- 6.5/6.8: Node.js — WS 客户端 + 定时器

**现有覆盖**: 无 ❌  
**是否可商业交付**: ⚠️ B-1 已修复 ✅; 核心安全流程需手动验收

---

### 场景 7: Alipay 支付 → Subscription 激活

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 7.1 | 查询可用套餐 | `GET /api/plans` | 返回 monthly/yearly 计划，amountFen 正确 | plans 表未 seed |
| 7.2 | 创建订单 | `POST /api/orders` | 200, order.status === 'pending_payment' | 订阅状态不允许 (suspended/cancelled) |
| 7.3 | 幂等创建 | `POST /api/orders` (same Idempotency-Key) | 返回同一 order, idempotent: true | — |
| 7.4 | 发起支付宝支付 | `POST /api/orders/:id/alipay` | 200, payUrl 是合法跳转 URL | **🟡 B-4: SDK 未验证**；config 未配置 → 503 |
| 7.5 | 支付宝回调 | `POST /api/payment/notify` (form-urlencoded) | 响应 'success'; order.status → confirmed | ~~B-2: CSRF 拦截~~ ✅ 已修复; 验签失败; 金额不匹配 |
| 7.6 | 验证订阅激活 | `GET /api/user/subscriptions` | status: 'active', paid_starts_at/paid_ends_at 正确 | updateSubPlan 计算错误 |
| 7.7 | 前端轮询 | `GET /api/orders/:id/status` | confirmedAt 有值, status === 'confirmed' | 回调延迟导致轮询超时 |
| 7.8 | 重复回调幂等 | 再次 `POST /api/payment/notify` (same order) | 响应 'success', 不重复激活 | — |
| 7.9 | 手动支付 + 管理员确认 | `POST /api/orders/:id/pay` → `POST /api/admin/orders/:id/confirm` | 状态流转正确 | — |
| 7.10 | 订阅续费叠加 | active 订阅再次支付 | paid_ends_at 从当前到期时间累加 | 起算点计算错误 |

**自动化方式**:
- 7.1-7.3, 7.6-7.10: Node.js — `supertest` (subscription-payment.test.js 部分覆盖)
- 7.4: Node.js — mock alipay-sdk 或使用沙箱
- 7.5: Node.js — 直接调用 `/api/payment/notify` 带伪造签名 (需先修复 B-2)

**现有覆盖**: subscription-payment.test.js 覆盖 7.2/7.9(部分) ✅ | 7.4-7.8 ❌ | 7.10 ❌  
**是否可商业交付**: ✅ B-2 已修复；自动支付确认链路畅通 (B-4 沙箱验证待完成)

---

### 场景 8: Forgot Password 完整流程

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 8.1 | 请求重置码 | `POST /api/auth/forgot-password` | 200, 统一提示消息 (不泄露邮箱是否存在) | SMTP 未配置 → 仅 console.log |
| 8.2 | 频率限制 | 同用户 1 小时内 >5 次 | 429 或 success (静默拒绝) | 计数逻辑错误 |
| 8.3 | 验证码正确重置 | `POST /api/auth/reset-password` | 200, password_hash 已更新 | 验证码过期 (>15min); 已使用 |
| 8.4 | 用新密码登录 | `POST /api/auth/login` | 200, 登录成功 | bcrypt hash 不一致 |
| 8.5 | 旧密码失效 | `POST /api/auth/login` (old pwd) | 401 INVALID_CREDENTIALS | — |
| 8.6 | 错误验证码 | `POST /api/auth/reset-password` (bad code) | 400 INVALID_CODE | — |
| 8.7 | 弱密码拒绝 | `POST /api/auth/reset-password` (pwd < 8) | 400 WEAK_PASSWORD | — |
| 8.8 | 页面渲染 | `GET /forgot-password` | 200, HTML 包含 step1/step2 表单 | 静态文件路径错误 |

**自动化方式**: Node.js — `supertest` + 直接读 DB 获取验证码 (绕过 SMTP)  
**现有覆盖**: 无 ❌  
**是否可商业交付**: ⚠️ 功能已实现但无测试覆盖；SMTP 未配置时降级为 console.log (可接受 MVP)

---

### 场景 9: ROM Profile 设备配对成功路径

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 9.1 | ROM 检测 | `RomProfile.detect(settingsPackage)` | AOSP/Huawei/Honor/Xiaomi/OPPO/Vivo 正确识别 | 未知厂商回退 AOSP |
| 9.2 | Stage 1: 开发者模式 | Accessibility click 版本号 ×7 | `developerOptionsEnabled = true` | 不同 ROM 版本号路径差异; PIN 弹窗拦截 |
| 9.3 | Stage 2: 导航 | Accessibility 导航到无线调试 | 页面标题匹配 `wirelessDebugLabels` | Settings app 结构变更; 深度嵌套菜单 |
| 9.4 | Stage 3: 开关 | Toggle 无线调试 switch | `isChecked = true` | 开关节点 ID 变更; 安全确认弹窗 |
| 9.5 | Stage 4: QR 配对 | 点击 "使用二维码配对" | 配对对话框出现, 扫码成功 | 对话框加载延迟; QR 解析失败 |
| 9.6 | Stage 5: 清理 | 离场后关闭开发者选项 | `developerOptionsEnabled = false` | 120s 超时; 系统权限限制 |

**自动化方式**: Android Instrumented Test (UI Automator 2.0)

```kotlin
// 伪代码示例
@Test fun testXiaomiProfile() {
    val profile = RomProfile.detect("com.android.settings")
    // 验证 buildNumberLabels 至少包含 "版本号"
    assertTrue(profile.buildNumberLabels.any { it.contains("版本号") })
}
```

**ROM 适配测试矩阵**:

| ROM | 型号 | Android 版本 | 测试方法 |
|-----|------|-------------|----------|
| AOSP | Pixel 7 | 14 | 模拟器 ✅ |
| MIUI | Redmi Note 12 | 13 | 真机 |
| HyperOS | Xiaomi 14 | 14 | 真机 |
| ColorOS | OPPO Reno 10 | 13 | 真机 |
| OriginOS | vivo X100 | 14 | 真机 |
| HarmonyOS | Huawei Mate 60 | — | 真机 |
| MagicOS | Honor 90 | — | 真机 |

**现有覆盖**: 无自动化测试 ❌ (仅有 Profile 对象声明，无 unit test)  
**是否可商业交付**: ⚠️ AOSP 可验证 (模拟器); 其他 ROM 需真机验收。节点查找有 78 条 label variants，覆盖面较好

---

### 场景 10: 订阅到期 → 权限降级

| 步骤 | 操作 | 依赖 API | 断言 | 可能失败点 |
|------|------|----------|------|-----------|
| 10.1 | Trial 到期 | 创建 trial 订阅 → mock 时间到 7 天后 | status 自动变为 expired | `refreshSubStatus()` 未调用; 时间计算错误 |
| 10.2 | 到期后签到拒绝 | `GET /api/checkin-qr` | 402 SUBSCRIPTION_NOT_ELIGIBLE_FOR_ISSUE | `canIssueQr()` 逻辑错误 |
| 10.3 | 到期后仍可支付 | `POST /api/orders` | 200, 订单创建成功 | `canSubmitPayment()` 逻辑错误 |
| 10.4 | Grace period | 配置 enableGracePeriod=true → active 到期 | status → grace, grace_ends_at 正确 | grace 配置未加载 |
| 10.5 | Grace → expired | 等待 graceDays 后 | status → expired | 同 10.1 |
| 10.6 | Admin 暂停 | `POST /api/admin/subscriptions/:id/suspend` | status → suspended | 已暂停幂等检查 |
| 10.7 | 暂停后签到拒绝 | `GET /api/checkin-qr` | 402 | — |
| 10.8 | Admin 恢复 | `POST /api/admin/subscriptions/:id/resume` | status 回到正确状态 (trial/active/grace/expired) | 状态推断逻辑错误 |
| 10.9 | 到期提醒邮件 | `scripts/expiry-reminder.js` | 查询 7/3/1 天内到期订阅并发送邮件 | SMTP 未配置; 查询 SQL 错误 |
| 10.10 | PM2 定时执行 | `ecosystem.config.js` | cron: `0 9 * * *`，脚本正常退出 | PM2 未安装; 脚本路径错误 |

**自动化方式**: Node.js — 直接操作 DB 设置过期时间 + `supertest` 验证 API 响应  
**现有覆盖**: subscription-state.test.js 覆盖 `canIssueQr`/`canSubmitPayment` 状态机 ✅ | 完整流程 ❌  
**是否可商业交付**: ⚠️ 状态机逻辑有 unit test 验证，但端到端流转未覆盖

---

## 二、自动化测试实施方案

### A. Node.js 侧 (factory-saas)

#### 新增测试文件清单

```
__tests__/
  integration/
    ├── auth-flow.test.js          (已有, 补充 logout + rate limit)
    ├── checkin-flow.test.js       (已有, 补充 token 过期)
    ├── subscription-payment.test.js (已有, 补充 renewal stacking)
    ├── device-token.test.js       (已有, 基本完整)
    ├── areas.test.js              (已有, 基本完整)
    │
    ├── csrf-exempt.test.js         ✅ 已有: CSRF 白名单全栈验证 (6 tests)
    │
    ├── forgot-password.test.js    ← 待新增: 场景 8 全流程
    ├── payment-notify.test.js     ← 待新增: 场景 7.5-7.8
    ├── websocket.test.js          ← 待新增: 场景 5 全流程
    ├── exit-flow.test.js          ← 待新增: 场景 6.2/6.6/6.7
    ├── subscription-expiry.test.js ← 待新增: 场景 10.1-10.8
    └── site-wifi.test.js          ← 待新增: 场景 2.3-2.7
```

#### 测试环境需求

```
- Node.js 18+
- 运行: npx jest --forceExit --detectOpenHandles
- 当前状态: 17 suites / 141 tests 全部通过 ✅
- 环境变量: JWT_SECRET, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD (test 值)
- DB: 自动使用临时 SQLite 文件 (每个 test suite 独立)
- 无需外部服务 (SMTP / Alipay 在测试中 mock 或跳过)
```

### B. Android 侧 (visitorapp)

#### 可自动化项 (Instrumented Test)

| 测试 | 框架 | 设备需求 |
|------|------|----------|
| ROM Profile detect() | JUnit (无 UI) | 模拟器 |
| buildNumberLabels 覆盖 | JUnit (参数化) | 模拟器 |
| WebSocket 连接 + 状态分发 | Robolectric | 模拟器 |
| Full ADB pairing flow | UI Automator 2.0 | 真机 × N ROM |

#### 需手动验收项

| 验收项 | 设备 | 验收标准 |
|--------|------|----------|
| Stage 1-4 自动化流程 | Pixel (AOSP) | 从扫码到 restricted ≤ 3 分钟 |
| Stage 1-4 自动化流程 | Xiaomi (MIUI) | 同上, 含 PIN 弹窗适配 |
| Stage 5 离场清理 | 各 ROM | 开发者选项自动关闭 |
| Immersive mode 防退出 | 各 ROM | 无法通过手势退出 |
| Screenshot 禁用 | 各 ROM | FLAG_SECURE + DPM 双保险 |

---

## 三、测试优先级排序

| 优先级 | 测试 | 类型 | 状态 |
|--------|------|------|------|
| **P0** | ~~修复 B-1 + B-2 (CSRF 白名单)~~ | Bug fix | ✅ 已修复 (`middleware/csrf.js` + `csrf.test.js` + `csrf-exempt.test.js`) |
| **P0** | payment-notify.test.js | 集成测试 | ❌ 待编写 |
| **P0** | exit-flow.test.js | 集成测试 | ❌ 待编写 |
| **P1** | forgot-password.test.js | 集成测试 | ❌ 待编写 |
| **P1** | websocket.test.js | 集成测试 | ❌ 待编写 |
| **P1** | subscription-expiry.test.js | 集成测试 | ❌ 待编写 |
| **P1** | site-wifi.test.js | 集成测试 | ❌ 待编写 |
| **P2** | ROM Profile unit tests | 单元测试 | ❌ 待编写 |
| **P2** | AOSP 模拟器全流程 | Instrumented | ❌ 手动 |
| **P3** | 多 ROM 真机验收 | 手动 | ❌ 手动 |

---

## 四、交付结论

### **A. 阻断问题已全部修复，系统可交付 MVP**

| 阻断项 | 问题 | 状态 | 修复内容 |
|--------|------|------|----------|
| **B-1** | CSRF 中间件阻断 Android 端 4 个 POST 端点 | ✅ 已修复 | `middleware/csrf.js` 新增 `CSRF_EXEMPT_PATTERNS` 正则白名单 |
| **B-2** | CSRF 中间件阻断支付宝异步回调 | ✅ 已修复 | 同上，`/api/payment/notify` 已豁免 |
| **B-3** | Android 端 `/api/checkin` CSRF 拦截 | ✅ 已修复 | 同上，`/api/checkin` 已豁免 |

#### CSRF 豁免端点安全画像

| 豁免路径 | 调用方 | 自有验证机制 | 测试覆盖 |
|---------|--------|-------------|----------|
| `/api/checkin` | Android App / welcome.html | checkinToken (HMAC-SHA256 签名 + 10 分钟过期) | csrf-exempt.test.js ✅ |
| `/api/sessions/:id/device` | Android App | deviceToken (timing-safe 对比) | csrf-exempt.test.js ✅ |
| `/api/sessions/:id/exit` | Android App | exitToken (UUID 随机密钥) | csrf-exempt.test.js ✅ |
| `/api/payment/notify` | 支付宝服务器 | RSA2 签名验证 | csrf-exempt.test.js ✅ |

#### 当前状态评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 核心业务链路 | ✅ | 注册→签到→管控→离场 (B-1/B-3 已修复) |
| 支付链路 | ⚠️ | 手工确认可用 ✅; CSRF 已修复 ✅; Alipay 沙箱待验证 (B-4) |
| 数据安全 | ✅ | CSRF (白名单端点自带独立验证) / JWT / bcrypt / timingSafeEqual / 私有 IP 校验 |
| 实时通信 | ⚠️ | 实现完整, 但无自动化测试佐证 |
| ROM 适配 | ⚠️ | AOSP 高置信度; 其他 ROM 需真机验收 |
| 自动化覆盖 | ⚠️ | 17 test suites / 141 tests; 5 个关键场景待补充 |

**系统已达到 MVP (最小可行产品) 交付标准。**  
**完整商业交付需补充 P1 测试 + Alipay 沙箱验证 (B-4) + ≥2 款 ROM 真机验收。**
