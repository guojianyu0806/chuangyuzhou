# 创宇宙 · AI WEB网页开发挑战赛

创宇宙是一款 AI 驱动的可搭建个人 Web 工作台。用户可用模块、空间和自定义方块组织资料、任务与日程，通过 AI 伙伴查询内容、生成方案和持续修订，并在审核确认后执行。

本目录用于第九届传智杯 **AI WEB网页开发挑战赛（10037）** 的独立开发、配置、测试和材料整理。创建日期：2026-10-23。产品仍为同一“创宇宙”，沿用现有仓库与真实 Git 历史。

## 入口

- [应用源码与运行说明](chuangyuzhou/README.md)
- [本目录工作规则](AGENTS.md)
- [本阶段工程记录](evidence/WEB-001.md)
- [材料整理清单](materials/README.md)
- [原有开发对话链](../evidence/prompt-chains/README.md)与[项目名称连续性说明](../docs/创宇宙-项目名称与开发连续性说明-v1.md)
- 代码仓库：<https://github.com/guojianyu0806/chuangyuzhou>
- 赛道官方详情：<https://www.boxuegu.com/matchTrack/detail/?id=10037>

## 本机运行

在仓库根目录执行：

```powershell
cd "web-track/chuangyuzhou"
node tools/verify-source.mjs
node tools/start.mjs --check
node tools/start.mjs
```

需要 Node.js ≥22.13。基础应用无需 `npm install` 或前端构建。默认地址为 **http://127.0.0.1:4396/**；也可运行本目录的 `启动Web赛道创宇宙.cmd`。

源码为普通物理文件，运行数据保存在应用自己的 `yuzhou/.cu-runtime/`。本入口使用独立端口和登录 Cookie；初始化账号由使用者在新环境自行建立。当前目录不携带其他环境的账号、业务数据、模型配置或 Key。

## 当前阶段

本阶段建立源码工作目录、运行隔离、文件校验和独立启动入口。应用已有自由画布、主子空间、业务模块、自定义方块、小程序，以及 AI 查询、修订、审核执行和有限撤销流程。本轮改动及实际检查见 WEB-001 记录。

现有工程测试、真实模型记录和演示材料继续保留各自日期及版本。本轮没有调用付费模型；Web 赛道的完整浏览器流程、AI 验证、技术 PDF、视频与最终交付将在后续阶段整理。

接下来依次推进：

1. 补充模型 Key 的环境变量配置与无秘密值示例，完善团队信息及环境说明。
2. 在本目录完成可复查的核心 AI 使用流程，记录实际请求、结果、失败和限制。
3. 按 Web 赛道重点整理技术 PDF，突出 AI 集成、可控工作流与前端交互。
4. 完整复看现有视频，按需要调整画面与解说，再统一文件、版本、链接及校验和。

## Git 与材料

当前使用上级仓库的 `.git`；本目录没有嵌套 Git 仓库，也没有新建远程项目。源版本提交及物理文件校验记录在 `evidence/WEB-001/baseline-files.json`；当前应用清单为 `chuangyuzhou/SOURCE-MANIFEST.json`。

旧源码、正式包、PDF、视频及用户另改文件保持原样。新的正式成品在后续明确版本后写入本目录，保留旧文件。本阶段只追加本地 Git 记录，未 push、上传、报名、缴费或提交作品。
