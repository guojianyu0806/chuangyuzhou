# 宇宙 · Android 客户端

手机与平板共用一个安卓安装包，应用名称为「宇宙」。这是使用 Android 系统 WebView 的独立客户端，连接现有私人服务器 `https://203.195.191.239`；安装后从桌面图标打开，没有浏览器地址栏。

## 安装与使用

1. 在手机或平板浏览器打开[安装页](https://203.195.191.239/apps/)，下载 APK。
2. 打开下载的文件，按系统提示允许当前浏览器或文件管理器安装此应用，再点安装。
3. 打开「宇宙」，登录原有工作台账号。新安装的 App 需要单独登录一次，不会继承浏览器的登录状态。
4. 两台设备登录同一账号，资料、任务、课程和账本由现有服务器同步。平板支持横屏及分屏。

首次打开、登录和同步需要网络。临时离线不会主动清理本机内容；同步状态以页面提示为准。本版没有后台推送通知。

导入文件使用系统文件选择器，导出使用系统保存窗口。安卓端单次导出上限为 256 MB；更大的完整备份请在电脑端导出。应用只申请联网权限，不需要通讯录、短信、摄像头或整个存储空间的权限。

应用顶部「⋮」可以回到主页、检查界面更新或查看版本。界面更新直接由服务器提供；安卓客户端自身更新时，下载后续同签名 APK 覆盖安装，保留已有 App 数据，不要先卸载。

## 构建与签名

源码位于 `android/app/src/main/`。不依赖 AndroidX、Gradle 或 npm 运行库。使用官方 Android SDK Platform 35、Build Tools 35.0.0 和现有 JDK，构建命令为：

```powershell
node mobile/build-android.mjs --version 1.0.0 --code 1
```

工具存放于项目 `.workbench/android-tools/`；脚本使用独立构建目录，不修改全局 Java/SDK 设置。支持 Android 8.0（API 26）及以上，目标 API 35。没有 CPU 原生库，同一 APK 可供 ARM 手机和平板使用。

每次构建另存为 `mobile/releases/yuzhou-android-<版本>-<UTC时间>.apk`，同时生成 SHA-256、签名摘要及版本元数据。不会覆盖旧安装包。交付应选用经过验证的最新包。

正式签名材料存放在 `E:\服务器秘钥\宇宙安卓签名`，不在源码或发布包里。保留此目录，后续覆盖安装需要同一签名；文件内容不得上传到下载页或写入日志。后续版本递增 `--code`。

## 安全与验证

- 工作台仅允许固定 HTTPS 来源在内部打开；其他 HTTPS 页面交给系统浏览器。
- 使用系统证书验证，不忽略证书错误，不允许明文 HTTP 和混合内容。
- 不使用 `addJavascriptInterface`。文件导出通过限定来源的主框架消息通道分块传输，再由用户选择保存位置。
- 同步资料、文件及账号仍由既有后端鉴权；APK 不包含账号密码、API 密钥或服务器 SSH 凭据。
- App 禁止 Android 自动备份本地登录及缓存；工作台仍可导出自己的完整备份。

参考：[Android WebView](https://developer.android.com/reference/android/webkit/WebView)、[系统文件选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[应用签名与更新](https://developer.android.com/studio/publish/app-signing)。

测试入口：`node --test mobile/tests/download-bridge.test.mjs`。可选设置 `YUZHOU_PLAYWRIGHT_MODULE` 指向已安装的 Playwright 模块，启用隔离浏览器完整备份测试。实际设备兼容性以 vivo 手机和平板安装后的结果为准。

2026-09-20：1.0.0 正式签名包构建、签名检查及公网下载哈希核验通过；14 项下载通道测试通过，其中包括现有页面完整备份导出。原生测试入口见 `tests/android-smoke/`。本机 Android 模拟器在 ADB 连接前退出，尚未执行原生运行测试，也尚未在 vivo 真机上验证；不得将构建成功描述为真机兼容性验证通过。

1.0.1（versionCode 2）修复启动闪退和星球图标遮挡。旧版在窗口内容建立前读取系统栏控制器，冷启动产生空指针；现改为先设置内容，再访问控制器。已在 Android 15 / API 35 模拟器复现旧包闪退，覆盖安装新包后正常启动至公网登录页且无崩溃日志。该验证没有登录生产账户，也不代表已完成 vivo 真机验证。

星环改为先绘制完整背环、白色星球居中、前半圈最后绘制，避免两个半弧接头留下细缝。安装页、工作台 SVG 标识和 Android VectorDrawable 使用相同几何与绘制顺序；64/128px 圆形及圆角预览通过遮挡检查。新包沿用 1.0.0 的签名，可直接覆盖安装；旧 APK 和安装页产物保留。

1.0.1 原生集成测试亦已通过：系统文件选择器导出中文测试文件后导回，内容一致；横屏切换后草稿保留；来源限制、MessagePort、哈希导航和弹窗返回键检查通过。测试使用全新模拟器和隔离页面，没有登录生产账号。完整结果见 `.workbench/visual-qa/native-smoke-20260920-123100/`；本机模拟器需将 SDK/AVD 放在纯 ASCII 临时路径才能正常启动。
