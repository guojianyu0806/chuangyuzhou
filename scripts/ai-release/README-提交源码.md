# 创宇宙

第九届传智杯 · AI 创新应用挑战赛

创宇宙把空间、笔记、清单、任务和日历放进同一个可搭建的工作台。用户可以请 AI 整理选中的卡片，修改或跳过建议，确认后应用主题。主题归属与自由画布位置、收纳盒成员分别保存。

## 10 分钟复现

需要 Node.js 22.13 或更新版本、本机浏览器和一个可写的解压目录。Node.js 自带 SQLite，基础应用无需运行 `npm install`。在本目录打开终端，依次执行：

```powershell
node --version
node tools/verify-source.mjs
node tools/start.mjs --check
node tools/start.mjs
```

打开 <http://127.0.0.1:4397/>。首次使用时在本机查看 `yuzhou/.cu-runtime/data/setup-code.txt`，按页面提示创建自己的账号。登录后进入搭建台，添加空间和清单，刷新后核对内容和位置。

如 4397 被占用，可将 `.env.example` 另存为 `.env` 并选择空闲的 4396 至 4399 端口。运行 `node tools/start.mjs --check` 确认地址。源码包的启动器只传入已列出的运行配置。数据、附件和首次初始化所用文件由应用记录在 `yuzhou/.cu-runtime/`。

## 用合成资料检查 AI 审核流程

```powershell
node tools/review-demo.mjs
```

打开终端显示的 <http://localhost:4398/>，从日志标出的本机文件查看初始化口令并建立演示账号。进入工作台后打开「按主题查看」，勾选「校园创作展筹备」和「布展前核对」，点击「AI 归类」。可修改建议；确认，刷新，然后撤销这一批归类。再回到画布，试着创建收纳盒、选择成员并折叠。演示启动器使用合成资料和本机模拟回复，每次启动新建独立工作区。按 Ctrl+C 停止。

常规启动支持用户在「偏好与连接」中配置自己的 DeepSeek 连接。模型请求需要网络与可用额度，由用户主动发起。正文提取为可选能力，使用 `requirements-extractor.txt` 和 `config/` 中的示例配置。

## 检查版本及开发记录

- `SOURCE-MANIFEST.json` 固定应用源码提交，逐个记录文件的 SHA-256。
- `SOURCE-NOTICE.md` 说明应用文件、运行脚本和测试证据的范围。
- `evidence/engineering/` 保留本次应用的自动回归记录。可以从本目录运行 `node scripts/test-yuzhou.mjs --dev DEV-053` 重跑。
- 提交材料的开发证据附件收录三条核心功能的原始对话摘编、Git 索引和关键差异。真实模型、模拟验收和性能数据各有明确版本及适用范围。
