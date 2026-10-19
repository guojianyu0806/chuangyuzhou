# 宇宙私人云部署记录

目标服务器：腾讯云广州轻量应用服务器 `203.195.191.239`。工作台使用独立的 `shiguang` 系统账号、进程和数据目录。原有 Hermes 网关及配置保留。

## 访问与首次设置

- 访问地址：`https://203.195.191.239/`。云防火墙需允许 TCP 80 和 443；80 用于证书自动验证，443 用于工作台访问。应用后端 4180 只监听服务器回环地址，不需要对公网放通。
- 首次初始化码保存在本机 `E:\服务器秘钥\宇宙首次设置码.txt`。打开该文件，在首次注册页填写码，再自选用户名和至少 12 字符的密码。此文档不包含码或密码。
- 两台电脑、手机和平板登录同一账号共享资料。旧版 `127.0.0.1:4173` 的浏览器数据保持原样；需要迁移时从旧版设置页导出完整备份，再在云端导入。
- 安卓手机和平板安装页：`https://203.195.191.239/apps/`。1.0.0 客户端使用系统 WebView 接入现有服务器，安装后登录原账号。安装包和公开安装页位于 `/opt/shiguang/mobile`；此目录不得存放签名密钥或私有资料。
- 在云端“偏好与连接”填写自己的 DeepSeek API 密钥后，AI 才能进行真实推理。默认模型为 `deepseek-flash`；Hermes 使用隔离的、无工具调用权限的任务进程整理资料。
- 当前没有 Windows 原生安装包、微信小程序、微信/QQ 自动消息读取或扫描件 OCR。

## 目录与服务

| 用途 | 路径或服务 |
| --- | --- |
| 代码版本 | `/opt/shiguang/releases/<release-id>/` |
| 当前版本链接 | `/opt/shiguang/current` |
| 私有数据 | `/var/lib/shiguang` |
| 环境配置 | `/etc/shiguang/workbench.env`，0600 |
| 工作台服务 | `/etc/systemd/system/shiguang.service` |
| HTTPS 配置 | `/etc/caddy/shiguang/workbench-ip.caddy` |
| 文档解析环境 | `/opt/shiguang/extract-venv`，pypdf 6.9.1 |
| 现有 Hermes 库 | `/home/ubuntu/.hermes/hermes-agent`，只读绑定 |
| 隔离 Hermes 任务目录 | `/var/lib/shiguang/ai/hermes` |
| 服务进程 HOME | `/var/lib/shiguang/agent-home` |
| 原 Caddy 配置备份 | `/var/backups/shiguang/before-cloud-20260920T083658Z/Caddyfile` |

HTTPS 使用 Let's Encrypt 的 IP 短期证书，交由 Caddy 自动申请和续期。必须保持端口 80 可用于 ACME 验证；实际公网连通与证书状态应通过不忽略证书错误的 HTTPS 请求确认。

2026-09-20 已完成公网 HTTPS 验证。由于浏览器使用 IP 地址访问时可能不发送 SNI，主 `/etc/caddy/Caddyfile` 顶部配置了全局 `default_sni 203.195.191.239`，使已申请的证书正确匹配；见 [Caddy 官方说明](https://caddyserver.com/docs/caddyfile/options#default-sni)。调整前的配置另存于 `/var/backups/shiguang/before-ip-tls-20260920T092641Z/Caddyfile`。这项设置不关闭证书校验。

工作台服务以最小系统账号运行，代码只读；仅数据目录可写。原 Hermes 服务不会被停止、覆盖或向公网额外开放。模型密钥保存在数据目录私有文件中，不返回给浏览器、不进入命令行或日志。

0.2.1 起产品名称统一为“宇宙”。服务器既有路径、系统账号、会话 cookie、浏览器存储键和备份格式标识继续使用原兼容标识，现有账号、登录状态及数据可直接使用；历史发布包和备份保留。

0.3.0 新增记账页面 `/#/ledger`，提供人民币收支、日期范围筛选、项目归集、编辑及归档恢复。账本与工作区一起保存和跨设备同步，也包含在完整 JSON 备份中。新功能不会为个人账号添加示例金额；旧资料在首次使用时补充空账本。旧页面提交缺少已有账本的快照会被拒绝，避免覆盖新记录。记账目前由用户手动录入。

2026-09-20 图标修复另存为 `/opt/shiguang/releases/0-3-0-iconfix-20260920-123159791013`，相对上一版只替换 `frontend/icon.svg`，旧代码目录保留。后端在启动时固定静态目录的真实路径，因此切换链接后进行了服务重启；重启前数据备份为 `/var/backups/shiguang/yuzhou-2026-09-20T12-32-46-488Z-143a0d9c`。公网图标哈希与本地修复版一致，业务版本仍为 0.3.0。

## 更新与回退

0.4.0 在共享卡片画布加入「自由画布 / 自适应 / 两列 / 三列 / 堆叠」。主页、课程列表及课程内部卡片、待办、碎片和自建空间可独立保存排列方式。堆叠模式支持上下滑动，拖动左侧指针改变展开位置，卡片经过指针时局部展开；支持键盘调整与减少动态效果偏好。模式和指针位置进入原有云端同步、备份流程，自由画布坐标保持原样。现有安卓客户端检查界面更新后即可使用，无需新 APK。

0.3.1 将移动底栏调整为「AI / 六级 / 空间 / 待办 / 更多」，空间位于正中间。320、390、760px 的位置、路由及高亮检查通过；800px 保留原侧栏布局。发布目录 `/opt/shiguang/releases/0-3-1-20260920-124452`，上一版与数据备份 `/var/backups/shiguang/yuzhou-2026-09-20T12-45-47-894Z-2abd0da8` 保留。客户端通过检查界面更新加载，无需重新安装 APK。

安卓包独立发布：使用 `mobile/build-android.mjs` 生成带时间戳的同签名 APK，然后通过 `publish-android.py <apk> <sha256> <index.html> <icon.svg>` 验证并发布。此脚本保留历史 APK，备份原安装页和 Caddy 站点配置后新增 `/apps/*` 静态路由，不重启或替换工作台后端。首次发布的配置备份为 `/var/backups/shiguang/android-downloads-20260920T121114242944Z`。本地签名材料仅保存在 `E:\服务器秘钥\宇宙安卓签名`，不上传到服务器；后续客户端递增 versionCode 并同签名覆盖安装。运行验证范围见 `mobile/README.md`。

1. 运行相关测试，生成新的唯一 release-id，把 `frontend/`、`backend/`、`deployment/` 的必要文件打包；不要打包 `.runtime`、`.workbench`、密钥、浏览器数据或私有配置。
2. 上传压缩包并核验 SHA-256。已有版本目录不可覆盖。
3. 更新前执行在线数据备份（命令如下）。通过 `activate-release.py <archive> <release-id>` 解压到新目录，记录旧链接并原子切换 `current`；然后 `systemctl restart shiguang`。
4. 检查服务、回环 health、可信公网 HTTPS、登录页资源与会话接口。上线验证失败时将 `current` 原子切回激活记录中的 `previous`，再重启服务；保留失败版本供排查。不要为了回退代码覆盖当前用户数据。

`activate-release.py` 和 `prepare-server.py` 以 root 通过已验证的 SSH 连接执行。首次准备脚本只新增账号/目录并备份代理配置；激活脚本不会替换现有私有配置或数据。原有 Caddyfile 已增加 `import /etc/caddy/shiguang/*.caddy`，原内容保留。

只读检查：

```sh
systemctl is-active shiguang caddy
curl -fsS http://127.0.0.1:4180/api/health
curl -fsS https://203.195.191.239/api/health
```

## 备份

```sh
sudo node /opt/shiguang/current/backend/backup.mjs \
  --data-dir /var/lib/shiguang --output-dir /var/backups/shiguang
```

每次备份使用新目录，保留历史文件。快照包含一致的 SQLite 在线备份、附件原件及哈希清单、AI 任务与私有模型配置。备份只能私密保存。当前提供手动在线备份工具，尚未设置定时备份或异地备份；同机备份不能应对服务器/磁盘丢失。

恢复时先停止服务并备份现有数据，将快照复制到新的私有数据目录，验证清单和 SQLite，再设置所属用户/权限并切换 `DATA_DIR`。保留原数据与唯一备份，不直接在备份目录运行服务。

## 验证范围

后端测试覆盖账号、精确 Origin/CSRF、私有附件、并发版本冲突、配额、在线备份和后台 AI 归档。浏览器测试覆盖双设备、手机布局、离线恢复、原件下载、AI 页面关闭后完成、失败重试及撤销。隔离测试中的模型输出是 fixture；真实 Hermes 实例通过无推理 probe 验证加载和零工具权限。填写有效 API 密钥前，不能将其视为真实 DeepSeek 调用成功。
