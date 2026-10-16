# 宇宙工作台 · 交付源码与10分钟复现指南

交付批次：DEV-031，2026-10-16。实际源码提交与逐文件哈希见 `SOURCE-MANIFEST.json`。本包是完整网页应用源码及测试的独立物理副本，不带作者账号、工作内容、模型Key、附件或数据库。以前的README随源码保留作历史记录；**首次启动以本文件为准**。

## 1. 环境与依赖

| 能力 | 需要什么 | 默认状态 |
| --- | --- | --- |
| 网页、账号、SQLite数据、搭建台、各业务模块、受控小程序运行器 | Node.js 22.13及以上，现代浏览器 | 无npm运行依赖，无前端构建步骤；不要运行旧部署或安卓构建脚本 |
| TXT、Markdown、CSV正文提取 | Node.js内建能力 | 可用 |
| DOCX、PPTX正文提取 | Python 3.10及以上标准库，显式配置 | 未配置 |
| 可复制文字的PDF | 上述Python加锁定的pypdf 6.21.0 | 未配置；OCR、扫描件识字及旧DOC/PPT不支持 |
| 真实AI查询、生成和修订 | 网络、自己申请的DeepSeek专用Key及可用模型额度 | 未配置；打开页面和保存设置不自动发起模型请求 |

Node官方入口：<https://nodejs.org/en/download>。本轮将另存实际运行版本和计时证据，不把版本范围全部说成实测通过。Python依赖来源：<https://pypi.org/project/pypdf/6.21.0/>，可选解析器使用 `requirements-extractor.txt` 固定版本与wheel哈希，不继承作者机器里的Python包。

## 2. 基础启动（先完成这一段）

前提：机器已安装满足要求的Node，解压软件包到一个**新的普通目录**。不要覆盖以前的工作台，也不要使用符号链接、目录联接或硬链接。运行目录必须可写。以下在解压后的根目录打开PowerShell执行：

```powershell
node --version
node tools/verify-source.mjs
Copy-Item -LiteralPath .env.example -Destination .env -ErrorAction Stop
node tools/start.mjs --check
node tools/start.mjs
```

`Copy-Item` 只在首次、确认没有 `.env` 时执行；已有配置直接保留。也可以直接双击 `启动工作台.cmd`，没有 `.env` 时使用相同安全默认值。启动后保持终端运行，访问 **http://127.0.0.1:4399/**。停止服务在该终端按Ctrl+C；下次执行相同命令会使用本包自己的数据，不会重建账号。

成功标志：校验输出 `check: passed`，终端出现 `listening on 127.0.0.1:4399`，页面显示首次创建账号。`node tools/start.mjs --check` 只检查环境、配置和源码，不表示端口已经监听。

1. 自行用文本编辑器打开本包 `yuzhou/.cu-runtime/data/setup-code.txt`，复制本次生成的初始化口令到页面。口令只用于首次初始化，不需要发给开发者或AI。
2. 自选账号名及至少12字符密码，点击创建。空白账号不携带作者数据，也不伪造已使用记录。
3. 进入工作台/搭建台，选择一个模块或模板；新增一条自己的待办或笔记，等待保存状态成功，再刷新核对。
4. 关闭并重新启动同一包，用刚创建的账号正常登录，检查该条内容仍在。账号和文件都在这份副本的 `.cu-runtime` 中。

如果需要同时运行多个本地副本，注意同一主机的同名Cookie可能互相影响登录；验收请使用独立浏览器配置/隐私窗口，不要在作者正式浏览器会话中切换到测试账号。

## 3. 配置模板与读取方式

`.env.example` 可复制为 `.env`，由本包 `tools/start.mjs` 显式读取；旧 `yuzhou/start.mjs` **不会自动读取 `.env`**。这里只允许以下两个字段：

| 字段 | 默认 | 允许范围 |
| --- | --- | --- |
| `CZB_YUZHOU_HOST` | `127.0.0.1` | 固定回环地址，不支持公网或局域网绑定 |
| `CZB_YUZHOU_PORT` | `4399` | 4396—4399；正式副本通常使用4397，本包另用4399 |

一行一个 `名称=值`，不加引号，不写shell表达式；未知字段、重复字段和非法端口会拒绝启动。启动入口清理继承的应用变量，不读取旧模型Key、旧数据路径或Hermes环境。运行数据固定在本包自己的 `yuzhou/.cu-runtime/data`；禁止指向其他项目。

`config/model-settings.example.json` 展示设置页对应字段，Key留空；`config/extractor-config.example.json` 展示解析器配置结构。它们是字段参考，**不自动加载、不要直接复制成运行配置**。真实Key通过正常登录后的“偏好与连接”填写；解析配置由下一节命令探测生成，不能把作者电脑的绝对路径直接照搬。

## 4. 可选：配置文档解析

在包内创建全新虚拟环境，不改全局Python。Windows PowerShell：

```powershell
python --version
python -I -m venv yuzhou/.cu-runtime/extractor-venv
```

用此虚拟环境安装锁定的可选依赖；缓存也限定在本包内。网络下载时间单独计量：

```powershell
$env:PIP_CACHE_DIR = Join-Path (Get-Location) 'yuzhou/.cu-runtime/pip-cache'
& .\yuzhou\.cu-runtime\extractor-venv\Scripts\python.exe -I -m pip --isolated install --only-binary=:all: --require-hashes -r requirements-extractor.txt --cache-dir $env:PIP_CACHE_DIR
$extractorPython = (Resolve-Path .\yuzhou\.cu-runtime\extractor-venv\Scripts\python.exe).Path
node scripts/configure-yuzhou-extractor.mjs --python "$extractorPython"
```

配置后重启本包。在设置页检查DOCX、PPTX、PDF可用性，再上传有正文的文件核对提取结果。只需要DOCX/PPTX时可跳过pip安装，Python标准库即可；此时PDF会显示不可用。更换解析器已有配置时先检查目标，明确需要替换才使用配置脚本的 `--replace`。

macOS/Linux的虚拟环境Python通常在 `yuzhou/.cu-runtime/extractor-venv/bin/python`；本轮Windows验收不能当成其他系统已验证。文档原件保留，扫描件和加密PDF不保证能够解析。

## 5. 可选：接入真实AI

正常登录后打开“偏好与连接”，选择官方DeepSeek及受支持的 `deepseek-v4-pro`，自行填写专用Key。参考字段见 `config/model-settings.example.json`。不要从任何旧副本复制 `model-config.json`，也不要把Key写入源码、`.env`、截图、视频或提交仓库。

“Key已保存”“引擎可用”“供应商真实响应成功”“具体业务任务通过”是不同状态。验证任务应主动发送需求，先查看查询与审核单，必要时修订，再点击确认；在确认前检查业务没有提前写入。小程序即使确认创建，也需要手动运行。模型调用会消耗供应商额度，本包的10分钟基础复现不自动调用模型，不代表真实AI效果复验。

## 6. 工程检查与源码结构

```powershell
node scripts/test-yuzhou.mjs --dev DEV-031
```

脚本使用Node内置测试工具，测试临时文件限定在本包 `.cu-runtime/tests-temp`，TAP输出到本包 `evidence/engineering/`。测试有独立合成数据；数量以本次报告为准，不累计历史版本结果。整套测试不是首次打开页面的前置步骤。

- `yuzhou/frontend/`：真实前端、搭建台、自由画布、AI审核与小程序渲染器。
- `yuzhou/backend/`：HTTP、认证、SQLite、模型连接、查询和解析。
- `yuzhou/runtime.mjs`、`start.mjs`：原有比赛隔离及启动代码，保持来源版本原样。
- `yuzhou/mobile/`、`deployment/`：公开工程历史源码保留，不纳入本包网页启动步骤；不运行签名、发布或部署操作。
- `tools/`：本交付的配置读取、清理环境和源码校验入口。
- `SOURCE-MANIFEST.json`、`SOURCE-NOTICE.md`：提交来源、逐文件校验和与复用说明。

本源码包不带 `.git` 历史或整套大体积开发证据；完整细粒度历史与三条开发链保留在比赛仓库中，提交评审时需另提供可访问的仓库。不能把源码ZIP当成Git过程记录。

## 7. 常见问题与复现结论范围

| 现象 | 检查方式 |
| --- | --- |
| 找不到node或SQLite导入失败 | 安装符合最低要求的Node并新开终端；不要用老Node忽略错误继续运行 |
| 端口占用/EADDRINUSE | 保留占用服务，改本包 `.env` 到另一个空闲允许端口；不要停止不明进程 |
| 初始化口令无效 | 只查看当前解压目录生成的文件；已经创建过账号时使用正常登录，不重置数据库 |
| 页面打不开 | 确认终端仍在运行、使用同一个端口和127.0.0.1，不用HTTPS或localhost替换已固定的写请求来源 |
| `competition_links_forbidden` | 重新解压到普通物理目录，不用链接或共享可写数据路径 |
| 源码校验失败 | 文件被修改或解压不完整；另解压原包比较，不覆盖已有使用数据。需要开发时在另一个副本修改并自行管理新哈希 |
| DOCX/PDF不可用 | 检查独立解析配置和Python路径，配置后重启；扫描PDF仍不支持OCR |
| AI未接入、限流或余额不足 | 确认自己的Key和供应商状态；不要把离线启动成功解释为真实AI成功 |

10分钟计时应从本包解压开始，记录环境检查、启动、正常初始化/登录、创建内容、刷新和重启读取。基础计时以Node已安装为前提，网络下载、真人阅读输入时间和模型请求分别说明。本机干净目录不等于全新电脑；最终结果与失败记录见包外本批次验收报告，不预先承诺任何机器都在10分钟内完成。
