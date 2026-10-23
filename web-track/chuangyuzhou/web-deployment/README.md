# 创宇宙 · Web服务运行

本目录提供WEB-004的网站运行配置。浏览器界面、业务数据格式、文件、画布、AI审核及小程序功能继续使用同一应用；Node统一提供页面和`/api/`，SQLite与原件保存在本副本自己的`yuzhou/.cu-runtime/`。当前为**单账号个人工作台**，可从不同浏览器登录同一服务；没有新增公众注册或多租户能力。

本阶段完成源码转换与本地验证，没有连接服务器、设置域名、申请证书或发布网站。以下域名和Linux路径均为示例。

## 1. 选择运行模式

保持[默认模板](../.env.example)可继续本机运行。要作为网站服务运行，在安装Node.js≥22.13的专用机器上把完整仓库放入新的普通可写目录，进入`web-track/chuangyuzhou`。不能只上传`frontend/`到静态托管，否则认证、保存、附件与AI功能均不可用。

若目标目录没有`.env`，将[environment.example](environment.example)复制为应用根目录`.env`；已有配置直接编辑并保留原值，不覆盖。把`CZB_YUZHOU_PUBLIC_ORIGIN`改为自己的完整HTTPS原点，例如`https://workbench.example.com`。该值不含路径、用户名、查询参数或片段；默认443会规范化。MODE与PUBLIC_ORIGIN可由启动终端同名变量覆盖，规则为终端优先于文件；本地模式必须清空PUBLIC_ORIGIN。

```text
CZB_YUZHOU_HOST=127.0.0.1
CZB_YUZHOU_PORT=4396
CZB_YUZHOU_MODE=web
CZB_YUZHOU_PUBLIC_ORIGIN=https://workbench.example.com
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
```

Key为空时仍能使用基础功能，并可在登录后的连接设置填写自己的Key；通过环境设置有效Key后，连接配置由环境接管且只读。真实Key只放在目标环境，不能提交Git。启动器仅传递模板中的配置和必要操作系统变量，不继承其他应用的数据目录、引擎或密钥。

```sh
node tools/verify-source.mjs
node tools/start.mjs --check
node tools/start.mjs
```

检查结果应显示`mode: web`、所填的HTTPS原点及`secureCookie: true`。Node仍监听`127.0.0.1:4396`，不能直接用其HTTP地址完成Web模式登录；浏览器应访问下一步提供的HTTPS网站。默认本机模式的账号、数据路径及启动命令保持兼容。便捷桌面启动器`yuzhou/launch.mjs`只接受本机模式，网站服务使用`tools/start.mjs`。

## 2. 同源HTTPS入口

在同一机器使用反向代理，把**专用域名的根路径**完整转发到`http://127.0.0.1:4396`。示例[Caddyfile](Caddyfile.example)依据[Caddy反向代理文档](https://caddyserver.com/docs/quick-starts/reverse-proxy)与[请求体上限文档](https://caddyserver.com/docs/caddyfile/directives/request_body)编写。修改域名后先在目标环境验证配置；本轮未安装Caddy或验证证书签发。

- 域名需解析到目标服务器，证书需被浏览器信任；公网HTTP不具备本应用所需的安全浏览器能力。
- 页面、API、文件和小程序固定渲染页统一转发；不挂载`/workbench/`等子路径，不另设前端域名。
- 保留原始`Origin`、方法、Cookie、`X-CSRF-Token`、`X-File-Name`与请求体；禁止把外来Origin改写成可信值。
- 不缓存身份、工作区、文件或AI任务结果，保留应用的`Cache-Control: no-store`。不把源码目录作为静态文件目录，不对外开放Node端口。
- 应用单文件上限40MiB，示例代理上限43,000,000字节；工作区JSON上限12MiB。代理不能降低为小于应用所需的限制。AI使用后台任务轮询，无WebSocket或SSE前置要求。

Web模式使用`__Host-czb_web_yuzhou_session`，带Secure、HttpOnly、SameSite=Strict和Path=/，不设置Domain；写操作继续校验固定HTTPS Origin与CSRF。应用不根据Forwarded头推断可信域名，也不信任X-Forwarded-For绕过限流。代理后的单账号共享登录限流，失败过多时等待后再试。

## 3. 首次使用和保留数据

通过HTTPS网站打开“建立你的工作台”。管理员在**本Web副本**的`yuzhou/.cu-runtime/data/setup-code.txt`查看初始化口令，创建自己的账号；口令不放入URL、截图或提交材料。初始化仅一次，后续使用账号密码登录。同一账号的工作区和原件由服务端保存；浏览器离线恢复副本与草稿仍保存在本设备。跨设备使用前应等待同步成功。

在新的目录首次部署时不会携带当前本机或其他项目的账号和资料。后续更新本实例时保留它自己的`.env`与`.cu-runtime`，不要以空目录覆盖数据库；更新前使用应用导出备份，文件和账号备份由管理员单独保管。停止服务后再做文件级备份，不在线复制SQLite作为唯一备份。上传解析仍按主README配置可选Python。

## 4. 持续运行与验收

[systemd示例](chuangyuzhou.service.example)适用于自行管理的Linux服务。创建专用账号并调整实际Node路径、项目目录和写权限后再使用；本机没有安装服务或改全局配置。可先保持前台运行验证，再决定服务管理方式。

上线时应在真实域名逐项检查：首次建立或登录账号；欢迎页与画布；搭建/子空间；待办、日历、笔记、记账保存刷新；上传下载原件；退出重登；服务停止再启动后数据保留；另一浏览器登录同账号并核对同步。AI另用自己的专用Key验证查询、修订、审核确认、保存、刷新及撤销；代码型小程序仍需手动启动。

当前自动检查用合成数据验证HTTPS Origin、Secure Cookie、鉴权、跨源拒绝、工作区与文件重启保留。真实公网TLS、Linux服务管理、真机和本轮真实AI请求尚未验收，不能以本地通过替代。
