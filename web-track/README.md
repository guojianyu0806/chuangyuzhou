# 创宇宙 · AI WEB网页开发挑战赛

创宇宙是一款 AI 驱动的可搭建个人 Web 工作台。用户可用模块、空间和自定义方块组织资料、任务与日程，通过 AI 伙伴查询内容、生成方案和持续修订，并在审核确认后执行。

本目录用于第九届传智杯 **AI WEB网页开发挑战赛（10037）** 的独立开发、配置、测试和材料整理。创建日期：2026-10-23。产品仍为同一“创宇宙”，沿用现有仓库与真实 Git 历史。

## 参赛信息

组别：**A组（211组）**。报名状态：**已报名**。

| 位次 | 成员 |
| --- | --- |
| 1 | 郭剑宇 |
| 2 | 单汝巨 |
| 3 | 栾健 |

成员顺序按本赛道报名位次保留。指导老师信息尚未提供。

## 入口

- [应用源码与运行说明](chuangyuzhou/README.md)
- [本目录工作规则](AGENTS.md)
- [当前团队与仓库更新记录](evidence/WEB-003.md)、[模型配置记录](evidence/WEB-002.md)与[独立目录建立记录](evidence/WEB-001.md)
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

已建立源码工作目录、运行隔离、文件校验和独立启动入口，并补齐 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 的环境变量接入，配置方法、优先级及设置页只读行为见[应用说明](chuangyuzhou/README.md#3-环境变量模板)。当前阶段补齐团队信息与公开仓库入口，后续再推进Web端转换。

现有工程测试、真实模型记录和演示材料继续保留各自日期及版本。本轮只整理仓库信息和同步公开源码；Web端转换、完整浏览器流程、真实AI验证、技术PDF、视频及最终交付按后续阶段推进。

接下来依次推进：

1. 完成公开仓库同步和可访问性核对后，按后续需求推进Web端转换。
2. 在独立环境配置自己的模型Key，并完成可复查的核心AI使用流程，记录实际请求、结果、失败和限制。
3. 按 Web 赛道重点整理技术 PDF，突出 AI 集成、可控工作流与前端交互。
4. 完整复看现有视频，按需要调整画面与解说，再统一文件、版本、链接及校验和。

## Git 与材料

当前使用上级仓库的 `.git`；本目录没有嵌套 Git 仓库，也没有新建远程项目。源版本提交及物理文件校验记录在 `evidence/WEB-001/baseline-files.json`；当前应用清单为 `chuangyuzhou/SOURCE-MANIFEST.json`。

旧源码、正式包、PDF、视频及用户另改文件保持原样。新的正式成品在后续明确版本后写入本目录，保留旧文件。本轮公开范围为当前Web目录、团队信息和仓库首页入口，使用原仓库 `main`；比赛提交和后续部署单独办理。
