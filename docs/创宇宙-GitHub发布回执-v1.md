# 创宇宙 · GitHub 发布回执 v1

发布日期：2026-10-19（北京时间）。

**公开仓库：[guojianyu0806/chuangyuzhou](https://github.com/guojianyu0806/chuangyuzhou)。已完成推送与无登录访问核验。**

## 已上传

- [正式源码与复现指南](https://github.com/guojianyu0806/chuangyuzhou/tree/main/submission/创宇宙-v1)：与原正式 ZIP 的 297 个文件字节一致，额外保留 Git 属性以防换行转换影响校验。
- [正式源码包、README、技术 PDF 及核查报告](https://github.com/guojianyu0806/chuangyuzhou/tree/main/delivery/2026-10-19_创宇宙正式提交_v1)。
- [比赛主线及真实提交](https://github.com/guojianyu0806/chuangyuzhou/commits/main)：原 188 条提交及其 SHA 保留，另有来源说明、规则核查与发布准备等真实当前提交。
- [早期快照补录分支](https://github.com/guojianyu0806/chuangyuzhou/tree/codex/yuzhou-historical-snapshots)：25 条事后补录，均明确使用 2026-10-19 实际记录日期，不伪装成当时的原始 Git。
- [三条 AI 开发对话链](https://github.com/guojianyu0806/chuangyuzhou/tree/main/evidence/prompt-chains)、早期对话及补丁、来源清单和工程证据。

## 远端历史核对

首次完整公开验证时：

| 分支 | 提交数 | 远端与本地一致的分支头 |
| --- | ---: | --- |
| `main` | 192 | `d5efcb270394f4ad0ab0edf1b1bc365848bb988b` |
| `codex/yuzhou-historical-snapshots` | 25 | `8d3b22714badc7abc532f09e04f1fc02efdf4780` |

无凭据全新克隆后，对比了两条分支的全部提交 SHA 集合，完全一致；原 188 条比赛历史仍是主线祖先。本回执、验证脚本和结果随后作为新的文档提交追加，未改写上述历史。公开推送只指定这两个分支，没有推送本地工具检查点或使用 `--mirror`。

## 无登录访问与复现

使用不带 Cookie、Authorization 或账号的独立 HTTP 请求，以下 8 项全部返回 HTTP 200：仓库首页、主线提交列表、最早真实提交页面、补录分支页面、根 README、正式源码 README、正式源码 ZIP、技术 PDF。

另在禁用 Git 凭据助手、认证头、Cookie、全局及系统 Git 配置的环境中，从 GitHub 全新克隆成功。克隆后的正式源码 297 文件与原包哈希全部一致；源码校验器检查 296 个清单文件通过；Node 22.23.3 的 `tools/start.mjs --check` 通过。没有为这次验证启动正式业务、读作者运行数据或调用付费模型。

下载的 ZIP 与 PDF 分别符合原成品 SHA-256：

```text
ZIP  1ec8fabc592472f612c298016545152b7e3f65dae083d2218adb89ebfb6f60b3
PDF  bc1433225ecf17ccea9a696f0b58e2493d073fd52ce71d09730d2feb61199705
```

详细请求、字节校验、分支头及验证时间见 [JSON 回执](../evidence/engineering/DEV-049-github-public-verification.json)。使用 [验证脚本](../scripts/verify-github-public-dev049.py) 时应另设新输出路径，避免覆盖已保存的证据。

## 保留与范围

原项目、旧成品、原始提交和用户其他修改保留。当前根 README 更新为“创宇宙”发布入口，更新前原文另存 `docs/archive/README-开发入口-发布前-v1.md`；正式 ZIP、README、PDF 没有覆盖。

作者已明确同意保留原提交中姓名、QQ 邮箱、旧机器路径与旧服务器地址。私人运行目录、密钥、未跟踪迁移数据、用户录音和完整原生私聊未纳入发布。

这是公开仓库访问与历史完整性验证，不是赛事提交回执，也不代表组委会已认可早期快照补录。测试说明所使用网络路径可以无登录访问，不能保证所有地区的网络连通性或未来持续可用性。本轮未代交比赛、联系组委会或新增开源许可证。
