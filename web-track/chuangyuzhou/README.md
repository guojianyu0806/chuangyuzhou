# 创宇宙

**让每个人搭建自己的工作台。** 创宇宙是一款可组合的个人工作台：用模块、空间和方块组织资料、日程与任务，由AI伙伴协助查询、提出方案，在用户审核确认后执行。

第九届传智杯AI WEB网页开发挑战赛（10037）· 开发版 WEB-003 · 2026-10-23。当前应用文件清单见 `SOURCE-MANIFEST.json`，本阶段改动见 `RELEASE-CHANGES.json`。

## 主要功能

- 自由画布、拖入搭建、尺寸调整、侧栏排序，以及主空间与子空间各自的画布。
- 课程、英语、灵感、待办、回顾、记账、日历、课表、比赛及AI伙伴等可选模块；课程与课表关联、账单分类和草稿恢复。
- 自定义便签、清单、表格等方块，以及先审核保存、再手动启动的代码型小程序。
- AI查询、方案生成、多轮修订、确认执行和有边界撤销；未配置模型时不伪装AI已连接。

创宇宙是一款AI驱动的可搭建个人Web工作台。前端采用HTML、CSS和原生JavaScript模块；Node.js提供认证、SQLite存储、查询、文件解析与模型接入。项目与版本说明见 `SOURCE-NOTICE.md`；内部 `yuzhou` 目录、数据库及备份标识保持兼容。

## 1. 环境和依赖

| 项目 | 条件 |
| --- | --- |
| 基础网页应用 | Node.js ≥22.13，现代桌面浏览器；本轮检查环境见上级evidence/WEB-002.md |
| npm依赖与前端构建 | 基础应用没有npm运行依赖，无需`npm install`或前端构建 |
| TXT/Markdown/CSV正文 | Node内建能力，无额外依赖 |
| DOCX/PPTX正文 | 可选Python ≥3.10；标准库实现 |
| 文字PDF正文 | 可选Python及`requirements-extractor.txt`锁定的pypdf；不支持OCR、旧DOC/PPT |
| 真实AI | 网络、自己的DeepSeek API Key及可用模型额度；支持启动环境变量或本机设置页 |

运行时下载：[Node.js](https://nodejs.org/en/download)、[Python](https://www.python.org/downloads/)。运行时不捆绑进源码包。最低版本是代码要求，不表示测试了所有更高版本或操作系统。

## 2. 十分钟基础复现

前提：已安装符合要求的Node。进入当前应用目录执行以下命令；后续源码ZIP应解压到新的普通可写目录，保留已有环境：

```powershell
node --version
node tools/verify-source.mjs
node tools/start.mjs --check
node tools/start.mjs
```

也可双击本目录的 **启动创宇宙.cmd**。默认访问 **http://127.0.0.1:4396/**，保持服务终端运行。校验成功会输出`check: passed`；`--check`本身不启动服务。

1. 首次打开出现“建立你的工作台”。用本机文本编辑器打开`yuzhou/.cu-runtime/data/setup-code.txt`，将初始化口令填入页面；不要把口令发给他人或放入提交材料。
2. 自选账号名和至少12字符的密码，创建账号。新账号不携带作者的资料或账号。
3. 在搭建台选择模板或模块，进入待办创建“准备读书分享会”，等待保存成功后刷新核对。
4. 在服务终端按Ctrl+C停止，再运行同一个启动命令；用刚创建的账号登录，核对任务仍在。

数据保存在本目录自己的`yuzhou/.cu-runtime/`。Web入口使用独立登录Cookie与固定4396端口，浏览器存储依照origin隔离。不要把当前使用中的账号导出包当作参赛源码。

基础复现不要求API Key，也不会自动调用付费模型。当前配置检查见上级 `evidence/WEB-002.md`，独立目录建立记录为 `evidence/WEB-001.md`；历史正式包的计时与验证仍归属原报告。

## 3. 环境变量模板

`.env.example`是可用模板，`tools/start.mjs`读取本目录`.env`；没有`.env`时采用相同默认值。需要显式保存本机配置时执行：

```powershell
if (Test-Path -LiteralPath .env) { throw '已有配置，请保留并直接编辑' }
Copy-Item -LiteralPath .env.example -Destination .env -ErrorAction Stop
```

| 字段 | 默认与范围 |
| --- | --- |
| CZB_YUZHOU_HOST | 固定为127.0.0.1，本开发版仅供本机复现 |
| CZB_YUZHOU_PORT | 固定为4396；端口被占用时保留其他服务并检查冲突 |
| DEEPSEEK_API_KEY | 默认留空；填写本Web环境专用Key后由环境配置接管模型连接 |
| DEEPSEEK_MODEL | 默认deepseek-flash；支持deepseek-v4-pro、deepseek-chat、deepseek-reasoner |

在本机编辑新建的 `.env`，填写 `DEEPSEEK_API_KEY`，按需要选择 `DEEPSEEK_MODEL`，保存后启动或重启工作台。示例文件中的Key保持空白；真实Key只写入被Git忽略的 `.env`。本轮没有为你填写或读取真实Key。

配置一行一个 `名称=值`，不加引号，不使用变量替换、表达式或行内注释。Key须为12至500个不含空白的可打印ASCII字符。未知字段、重复字段及非本入口端口会被拒绝，错误信息不会回显配置值。

也可由当前启动终端设置这两个模型环境变量。同名变量优先级为：**启动终端 > 本目录 `.env`**；Key有效时，环境配置优先于设置页保存的连接。终端中显式设置空Key会覆盖文件Key。空Key视为未启用环境连接，仅有模型名不会改动原本机配置。除这两个模型变量外，启动器继续拒绝继承其他应用密钥、引擎目录和数据路径。

环境连接在启动时读入并仅保存在服务端内存，不写入 `ai/model-config.json`，状态接口不返回Key或任何片段。设置页会显示“由启动环境配置”，禁用Key、模型和保存按钮；直接调用保存或清除接口也会被拒绝。修改后需要重启。移除或清空有效环境Key并重启后，原设置页配置仍保留并恢复可用。

`config/model-settings.example.json`与`config/extractor-config.example.json`仅为字段参考，不自动加载。未启用环境连接时仍可通过登录后的“偏好与连接”配置模型；解析器使用下一节命令生成自己的配置。

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

先按上一节配置环境Key，或在未启用环境连接时通过“偏好与连接”填写自己的专用Key与受支持模型。环境连接默认 `deepseek-flash`，模型实际可用性取决于供应商与账号。配置就绪、供应商响应和业务完成是不同状态；启动、配置检查和查看状态均不会调用模型。

例如发送“为周末读书分享会建立筹备空间，并列出三项准备任务”，查看查询结果与审核单，需要时继续修订，再点击“确认执行”。检查任务和空间是否落地、刷新后是否保留。小程序创建后需单独点击运行；历史真实模型验证不代表未来每次生成都成功。模型额度由使用者自行准备，基础复现与本次打包验证不自动收费调用。

## 6. 测试与结构

```powershell
node scripts/test-yuzhou.mjs --dev WEB-002
```

测试使用独立合成数据，输出在`evidence/engineering/`；`.test.mjs`是本包自动回归入口。旧的非`.test.mjs`浏览器脚本保留可读源码，但已加显式禁用保护，避免意外连接其他实例；不要把它们当作评委复现步骤。

- `yuzhou/frontend/`：页面、搭建台、画布、AI审核及小程序运行器。
- `yuzhou/backend/`：认证、SQLite、模型接口、工作区查询和文档解析。
- `tools/`：本包启动和文件哈希核对；`scripts/`：测试及可选解析配置。
- `yuzhou/mobile/`、`yuzhou/deployment/`：历史源码，构建与部署入口已禁用，不属于本次网页交付。
- `SOURCE-NOTICE.md`：同一项目的名称关系、持续迭代与交付边界。
- `SOURCE-MANIFEST.json`、`RELEASE-CHANGES.json`：源提交、逐文件哈希及包内转换记录。

当前目录沿用上级仓库的Git项目，完整提交历史与开发对话由仓库承载。独立源码包定稿时不包含作者业务数据或凭据。代码仓库：https://github.com/guojianyu0806/chuangyuzhou 。

## 7. 常见问题

| 问题 | 处理 |
| --- | --- |
| node或SQLite不可用 | 检查Node最低版本并重新打开终端 |
| EADDRINUSE | 保留原有服务，检查4396端口冲突，不停止不明进程 |
| 初始化口令无效 | 使用当前解压副本的口令；已有账号直接登录，不重建数据库 |
| 源码校验失败 | 解压新的完整副本比较，不覆盖已使用的数据 |
| 文档解析不可用 | 配置独立Python并重启；扫描PDF不支持OCR |
| AI未接入或请求失败 | 检查自己的模型配置、额度与网络，按界面提示重试 |
| 显示本机连接失败 | 重新运行“启动创宇宙.cmd”，检查地址与端口 |

安全与兼容边界：仅本机访问；不提供已验证的公网部署或安卓安装包；未完成独立真人收益试验、完整真机兼容或外部安全审计。“宇宙”与“创宇宙”为同一项目；早期快照补录的性质明确标注，不把工程核查作为赛事资格认可。

## 8. 参赛信息与当前阶段

产品：创宇宙。赛道：AI WEB网页开发挑战赛（10037）。参赛组别：**A组（211组）**。报名状态：**已报名**。

| 位次 | 成员 |
| --- | --- |
| 1 | 郭剑宇 |
| 2 | 单汝巨 |
| 3 | 栾健 |

指导老师信息尚未提供。成员顺序按本赛道报名位次保留。

模型环境变量接入及相关检查已于WEB-002完成，验证使用合成Key和模拟接口。当前阶段补齐团队及公开仓库信息，应用逻辑保持不变；后续Web端转换、真实AI流程与材料定稿另按具体任务推进。本轮不修改技术PDF、视频或旧正式源码ZIP。
