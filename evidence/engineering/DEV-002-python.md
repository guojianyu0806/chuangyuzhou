# 完整宇宙副本的Python离线验证

日期：2026-10-08；解释器：本机已有Python 3.13，未安装依赖或修改全局配置。

在比赛复制件 `yuzhou/` 中执行：

```text
python -B -I backend/tests/extract_test.py
python -B -I backend/tests/hermes_runner_test.py
python -B -I backend/tests/competition_python_cli_test.py
```

TEMP、TMP和TMPDIR仅在测试进程设置为本副本 `.cu-runtime/python-tests`；关闭字节码输出。未读取原项目运行数据。

初次结果：文件解析5项通过，Hermes适配器模拟测试9项通过，退出码均为0。前者包含中文文本、DOCX、PPTX、空文件和不支持格式路径；后者使用模拟Hermes模块，不调用真实模型。

交叉审查后新增4项直接CLI隔离测试，验证副本内解析、拒绝越界、拒绝硬链接且原件不变、清除旧环境的模拟引擎探测。首次18项中的2项因Windows隔离模式忽略PYTHONIOENCODING而解码失败，随后在两个CLI显式指定UTF-8输出。最终18项全部通过，0失败，用时2.267秒。

实际解释器为本机已有 `E:\应用\Python313\python.exe`，均使用 `-B -I`，仅在本比赛目录执行。没有执行真实PDF文件解析，也没有连接或安装Hermes引擎，不能将这些通过结果解释为生产AI与所有文件类型已就绪。
