# 创宇宙开发测评脚手架

当前只有6个按规则构造的合成开发样例，预期结果由AI代理显式编写，尚未独立人工复核。没有留出成绩，没有真实用户记录。该小集合只帮助尽早验证创建、布局、记录、来源和澄清链路，不是规划中的正式40题测评集。

在新项目根目录运行：

```powershell
node evaluation/run-development.mjs
node evaluation/run-development.mjs --fixture
node --test tests/ai-planner.test.mjs tests/provider.test.mjs evaluation/evaluation.test.mjs
```

第一条只返回样例元数据，不读取模型配置、不调用模型、不保存结果。第二条使用明确的预设离线回复，验证方案预演和应用至内存状态的过程；它的通过结果不是AI表现。结果保存在新项目自己的`.cu-runtime/evaluation/dev-时间-随机编号`，不覆盖旧结果。

真实开发调用需要用户先准备创宇宙专用配置和预算。调用方可通过`runDevelopmentEvaluation({live:true,config,...})`传入新实例配置，不读私人或旧实例数据库。CLI只在明确`--live`时读取`--config-file`；配置必须是本项目`.cu-runtime`内的普通、非链接、非硬链接JSON文件，包含`provider:"deepseek"`、`model`和`apiKey`。不读取环境变量，不把配置或密钥写入结果。没有`--live`时即使提供配置文件参数也不会读取文件。

```powershell
node evaluation/run-development.mjs --live --config-file .cu-runtime/evaluation-config.json --cases cu-dev-001,cu-dev-002
```

此命令会发送合成工作区数据并可能产生API费用；本次开发没有运行它。账号、余额、限流、超时和网络失败后停止余下题目，并明确记录未尝试项。默认不自动重试。没有价格输入时费用保持`null`；usage只保留供应商实际返回的合法计数。

每次记录JSONL、机械检查CSV、汇总JSON、模型/提示词版本、代码hash、耗时及失败。正常输出记录最终待审核方案；格式错误等失败只保存安全错误码，不回显原始远程响应。自动判定只检查所列机械约束，不能证明引文语义支持、追问有效或效率提升；所有结果均标记`semanticReview:pending`。正式报告前需要独立核对者、扩充冻结任务集、公平对照与真人试用。

配置边界测试仅创建自己的新fixture目录；测试用链接用于验证拒绝路径，不是运行时共享配置。任何fixture都不是真实密钥或真人反馈。旧项目和旧60题校园数据没有被修改或作为新平台成绩使用。
