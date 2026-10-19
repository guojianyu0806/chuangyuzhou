# DEV-045 · 创宇宙正式提交版材料入口

成品在`../2026-10-19_创宇宙正式提交_v1/`：源码ZIP、README、13页技术PDF，以及单独供作者检查的报告与SHA-256清单。旧版保持，本轮不上传。

本目录保留README模板、技术源稿和PDF生成器。`scripts/package-dev045.py`从明确Git基线生成新包；转换清单记录发布副本的名称和机器信息清理。`scripts/verify-dev045.py`验证全新ZIP复现，`scripts/verify-dev045-ui.mjs`使用独立浏览器与合成账号核对关键操作。所有输出创建均拒绝覆盖已有成品；重做须使用新版本路径。

源码基线9c567d7d3c3a；应用业务目录未修改。打包时的品牌与清理转换是本轮真实整理工作，不伪装为源基线已具备的原始内容。完整范围及失败见`evidence/dev/DEV-045.md`，最终验证见`evidence/engineering/DEV-045-final-verification.json`。

PDF中历史截图保留原样及阶段标签，未用新品牌改写旧截图。生成器依赖本比赛保留的三张历史截图、ReportLab、pypdf、pypdfium2及Windows中文字体；这些制作依赖不是运行应用的依赖。
