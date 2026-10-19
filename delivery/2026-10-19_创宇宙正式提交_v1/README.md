# 创宇宙

**让每个人搭建自己的工作台。** 创宇宙是一款可组合的个人工作台：用模块、空间和方块组织资料、日程与任务，由AI伙伴协助查询、提出方案，在用户审核确认后执行。

传智杯AI创新应用挑战赛 · 正式提交版 v1 · 2026-10-19。源代码基线 `9c567d7d3c3a069fe681723f1aa9cbc350407d0f`；包内名称及发布清理见 `RELEASE-CHANGES.json`，完整文件哈希见 `SOURCE-MANIFEST.json`。

## 功能与来源

- 自由画布、拖入搭建、尺寸调整、侧栏排序，以及主空间与子空间各自的画布。
- 课程、英语、灵感、待办、回顾、记账、日历、课表、比赛及AI伙伴等可选模块；课程与课表关联、账单分类和草稿恢复。
- 自定义便签、清单、表格等方块，以及先审核保存、再手动启动的代码型小程序。
- AI查询、方案生成、多轮修订、确认执行和有边界撤销；未配置模型时不伪装AI已连接。

项目基于作者既有“宇宙”0.15.0，在独立比赛副本中持续开发。本次新增贡献与复用边界见 `SOURCE-NOTICE.md`。内部`yuzhou`目录、包名、数据库及备份标识保留兼容；当前产品展示名统一为“创宇宙”，历史来源名称不改写。

## 1. 环境和依赖

| 项目 | 条件 |
| --- | --- |
| 基础网页应用 | Node.js ≥22.13，现代桌面浏览器；本批次实测Windows、Node 22.23.3 |
| npm依赖与前端构建 | 基础应用没有npm运行依赖，无需`npm install`或前端构建 |
| TXT/Markdown/CSV正文 | Node内建能力，无额外依赖 |
| DOCX/PPTX正文 | 可选Python ≥3.10；标准库实现 |
| 文字PDF正文 | 可选Python及`requirements-extractor.txt`锁定的pypdf；不支持OCR、旧DOC/PPT |
| 真实AI | 网络、自己的DeepSeek API Key及可用模型额度；通过应用设置配置 |

运行时下载：[Node.js](https://nodejs.org/en/download)、[Python](https://www.python.org/downloads/)。运行时不捆绑进源码包。最低版本是代码要求，不表示测试了所有更高版本或操作系统。

## 2. 十分钟基础复现

前提：已安装符合要求的Node。将ZIP解压到**新的普通可写目录**，避免覆盖旧工作台。以下命令全部在解压后的包根目录运行：

```powershell
node --version
node tools/verify-source.mjs
node tools/start.mjs --check
node tools/start.mjs
```

也可双击包根目录的 **启动创宇宙.cmd**。默认打开浏览器访问 **http://127.0.0.1:4399/**，保持服务终端运行。校验成功会输出`check: passed`；`--check`本身不启动服务。

1. 首次打开出现“建立你的工作台”。用本机文本编辑器打开`yuzhou/.cu-runtime/data/setup-code.txt`，将初始化口令填入页面；不要把口令发给他人或放入提交材料。
2. 自选账号名和至少12字符的密码，创建账号。新账号不携带作者的资料或账号。
3. 在搭建台选择模板或模块，进入待办创建“准备读书分享会”，等待保存成功后刷新核对。
4. 在服务终端按Ctrl+C停止，再运行同一个启动命令；用刚创建的账号登录，核对任务仍在。

数据保存在这份解压副本自己的`yuzhou/.cu-runtime/`。多份本地实例的同名Cookie可能影响登录，验收请用独立浏览器配置或隐私窗口。不要把当前使用中的账号导出包当作参赛源码。

基础复现不要求API Key，也不会自动调用付费模型。计时与验证范围见随交付提供的《提交前核查报告》；Node安装下载、真人阅读输入时间、独立设备体验和模型任务不包含在自动化计时中。

## 3. 环境变量模板

`.env.example`是可用模板，本包`tools/start.mjs`读取包根目录`.env`；没有`.env`时采用相同默认值。首次需要修改端口时执行：

```powershell
if (Test-Path -LiteralPath .env) { throw '已有配置，请保留并直接编辑' }
Copy-Item -LiteralPath .env.example -Destination .env -ErrorAction Stop
```

| 字段 | 默认与范围 |
| --- | --- |
| CZB_YUZHOU_HOST | 固定为127.0.0.1，本提交版仅供本机复现 |
| CZB_YUZHOU_PORT | 默认4399，允许4396—4399；端口被占用时选择另一个空闲端口 |

配置一行一个`名称=值`，不加引号；未知字段、重复字段及非法端口会被拒绝。不要加入密钥、数据库路径或旧服务器配置。启动入口不会继承其他项目的应用变量。

`config/model-settings.example.json`与`config/extractor-config.example.json`仅为字段参考，不自动加载。模型Key通过登录后的“偏好与连接”填写，解析器使用下一节命令生成自己的配置。

## 4. 可选文档解析

在包根目录用独立虚拟环境配置，不修改全局Python：

```powershell
python --version
python -I -m venv yuzhou/.cu-runtime/extractor-venv
& .\yuzhou\.cu-runtime\extractor-venv\Scripts\python.exe -I -m pip --isolated install --only-binary=:all: --require-hashes -r requirements-extractor.txt --cache-dir .\yuzhou\.cu-runtime\pip-cache
$extractorPython = (Resolve-Path .\yuzhou\.cu-runtime\extractor-venv\Scripts\python.exe).Path
node scripts/configure-yuzhou-extractor.mjs --python "$extractorPython"
```

重启服务后上传带正文的DOCX/PPTX/PDF，检查原件下载与正文提取。只需要DOCX/PPTX时可跳过pip安装。扫描件和加密PDF不保证可解析，旧DOC/PPT不支持。替换已有解析配置前保留旧配置并明确使用脚本的`--replace`。

## 5. 可选AI体验

登录后进入“偏好与连接”，选择DeepSeek，填写自己的专用Key与受支持模型。参考配置使用`deepseek-v4-pro`，实际可用性取决于供应商与账号。Key保存、供应商响应、业务完成是不同状态。

例如发送“为周末读书分享会建立筹备空间，并列出三项准备任务”，查看查询结果与审核单，需要时继续修订，再点击“确认执行”。检查任务和空间是否落地、刷新后是否保留。小程序创建后需单独点击运行；历史真实模型验证不代表未来每次生成都成功。模型额度由使用者自行准备，基础复现与本次打包验证不自动收费调用。

## 6. 测试与结构

```powershell
node scripts/test-yuzhou.mjs --dev DEV-045
```

测试使用独立合成数据，输出在`evidence/engineering/`；`.test.mjs`是本包自动回归入口。旧的非`.test.mjs`浏览器脚本保留可读源码，但已加显式禁用保护，避免意外连接其他实例；不要把它们当作评委复现步骤。

- `yuzhou/frontend/`：页面、搭建台、画布、AI审核及小程序运行器。
- `yuzhou/backend/`：认证、SQLite、模型接口、工作区查询和文档解析。
- `tools/`：本包启动和文件哈希核对；`scripts/`：测试及可选解析配置。
- `yuzhou/mobile/`、`yuzhou/deployment/`：历史源码，构建与部署入口已禁用，不属于本次网页交付。
- `SOURCE-NOTICE.md`：既有项目来源、比赛新增工作和公开边界。
- `SOURCE-MANIFEST.json`、`RELEASE-CHANGES.json`：源提交、逐文件哈希及包内转换记录。

本ZIP不含`.git`、作者业务数据或完整Prompt证据。评审所需完整Git历史及三条开发链应由另行提供的GitHub/Gitee仓库承载；本地源码包不代替该要求。仓库尚未上传时，不把本地路径当作可访问仓库链接。

## 7. 常见问题

| 问题 | 处理 |
| --- | --- |
| node或SQLite不可用 | 检查Node最低版本并重新打开终端 |
| EADDRINUSE | 保留原有服务，修改本包端口，不停止不明进程 |
| 初始化口令无效 | 使用当前解压副本的口令；已有账号直接登录，不重建数据库 |
| 源码校验失败 | 解压新的完整副本比较，不覆盖已使用的数据 |
| 文档解析不可用 | 配置独立Python并重启；扫描PDF不支持OCR |
| AI未接入或请求失败 | 检查自己的模型配置、额度与网络，按界面提示重试 |
| 显示本机连接失败 | 重新运行“启动创宇宙.cmd”，检查地址与端口 |

安全与兼容边界：仅本机访问；不提供已验证的公网部署或安卓安装包；未完成独立真人收益试验、完整真机兼容或外部安全审计。项目含既有作者源码复用，来源如实披露，不承诺赛事资格已经获得组委会确认。
