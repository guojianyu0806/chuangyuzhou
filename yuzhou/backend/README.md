# 宇宙完整副本后端 · 基于0.15.0

这是传智杯目录中的独立复制件。原业务API保留；当前只在本机运行，不连接原服务器。数据、文件、模型配置、备份和可选Hermes引擎都限定在相邻 `../.cu-runtime/`，禁止指向原项目的路径和链接。DEV-003默认改为Node直连DeepSeek官方接口；文件解析独立配置，可只读使用本机已有通用Python，执行本比赛解析脚本，所有临时文件仍写入本副本。真实模型尚未试测。

Node.js 22.13+（部署建议采用受支持的 Node 22 或 24 版本），使用内置 HTTP、SQLite 和密码学模块。没有 npm 运行依赖。Node 22 的 SQLite 模块可能输出实验性功能提示。

记账以工作区中的 `ledger` 字段同步，使用相邻 `frontend/src/ledger-model.js` 的共享校验规则；部署时须一起保留前端目录。金额为正整数分，日期必须是实际日历日期，项目引用必须存在。旧客户端不能提交会移除已有账本的工作区快照；完整备份保留账本项目、收支及归档状态。

## 启动

```
node yuzhou/launch.mjs
```

在比赛根目录执行以上命令，默认地址 `http://127.0.0.1:4397/`。启动器核对实例身份，复用同一副本或新启动后打开浏览器；不会停止其他占用端口的程序。也可运行 `node yuzhou/start.mjs`，或在本目录执行 `npm start` 直接启动服务。当前允许的独立配置如下；不沿用其他项目的环境变量或初始化口令：

| 环境变量 | 含义 |
| --- | --- |
| `CZB_YUZHOU_HOST` | 仅允许 `127.0.0.1` |
| `CZB_YUZHOU_PORT` | 默认4397；仅允许4396—4399，4398保留给合成浏览器验证 |
| `CZB_YUZHOU_DATA_DIR` | 默认 `yuzhou/.cu-runtime/data`；任何覆盖值也必须在本副本 `.cu-runtime` 内 |
| `SETUP_TOKEN_FILE` | 默认数据目录下 `setup-code.txt`，首次自动生成，仅读取本副本内文件 |

前端固定为本复制件 `frontend/`，访问源由回环地址和端口生成。Cookie名为 `czb_yuzhou_session`，本机HTTP不启用Secure；此配置不能直接用于公网。历史通用环境变量若指向旧端口、旧数据或外部目录会被拒绝。独立Hermes目录预留在 `.cu-runtime/engines/hermes`，启动时不继承旧引擎环境和凭据。

初始管理员通过注册页面输入本副本生成的随机 setup token、自选用户名及至少12字符的密码。仅允许创建一个账号；账号创建和关闭注册在同一SQLite事务中完成。初始化后的再次启动继续使用已有账号，不会重新开放注册；口令文件仍由本副本启动器管理。不要把setup token、密码或模型Key放进前端代码、Git、日志或公开交付文档。

所有写请求必须提供与服务端 `publicOrigin` 完全一致的 `Origin`；本启动器据回环地址与端口生成此值。已登录写请求还必须包含 `X-CSRF-Token`，从登录响应或 `/api/auth/session` 获取。测试实例未传 `publicOrigin` 时只接受当前回环源。

## API

- `GET /api/health`：公开最小服务状态。
- `GET /api/instance`：公开本副本身份摘要，用于启动器检查；不返回数据路径或账号内容。
- `GET /api/auth/session`：登录和初始化状态；登录后返回 CSRF token。
- `POST /api/auth/setup`：`{username,password,setupToken}`，仅首次可用。
- `POST /api/auth/login`、`POST /api/auth/logout`：持久登录会话，HttpOnly / SameSite=Strict；当前回环HTTP不设Secure，HTTPS模式才设置。
- `GET /api/workspace`：`{revision,state,updatedAt}`。
- `GET /api/workspace?since=revision`：版本未变仅返回 `{revision,unchanged:true}`，改变后才返回完整数据；用于多设备轮询，减少有限带宽开销。
- `PUT /api/workspace`：`{baseRevision,state}`；只接受 schema 1 的 personal 工作区，大小 12 MiB，版本冲突返回 409。当前版本和最近 20 个旧版本保存在 SQLite。文件引用必须已上传成功。
- `PUT /api/files/:id`：原始二进制，40 MiB 上限；`Content-Type` 与 `X-File-Name: encodeURIComponent(name)`。同一 ID 相同字节可重复上传，不同内容返回 409。
- `GET /api/files/:id`：登录后下载，attachment / nosniff / sandbox / no-store。
- `HEAD /api/files/:id`：检查远端附件，返回 Content-Length、ETag（SHA-256）、X-File-Name。
- `GET /api/files/:id/text`：登录后按已上传文件ID解析正文，最多同时处理两份；返回正文单元及限制提示。原件不变，不调用模型，不接受任意磁盘路径。
- `/api/model/*`、`/api/ai/*`：交给相邻 `hermes.mjs` 模块；服务先统一检查身份、来源、CSRF。

附件 ID 允许 1–128 位 ASCII 字母、数字、下划线及短横线，以字母数字开头。兼容浏览器生成的 UUID。默认附件存储总上限 10 GiB。删除工作区条目不会立即删除原件，避免恢复和并发同步造成文件损失；清理功能需后续按引用和历史保留规则实现。

静态资源仅开放 `/`、index、icon、manifest 和 `src/` 下允许的资源类型，测试、README、隐藏文件、私有数据及代码目录外符号链接均不可访问。

## 模型与文件处理

`deepseek.mjs`使用固定官方接口，禁止重定向、限制请求时长和响应大小，并返回固定错误分类；关闭服务会取消活动请求。`hermes.mjs`继续承载队列、查询、白名单行动、结构校验、方案版本检查和人工确认，不因更换传输层绕过确认。默认引擎为`deepseek-direct`，Hermes是可选兼容路径。`engineAvailable`表示传输代码具备运行条件，`configured`表示已保存专用Key，均不证明真实接口可达或模型效果。构造服务、保存Key及查询状态不调用模型，本轮仅使用离线注入验证模型链路。

`extractor.mjs`原生解析TXT、MD、CSV；逐格式报告能力，不把上传成功当成已读懂资料。本机DOCX/PPTX和文本PDF已配置使用只读的Codex内置Python及pypdf执行本目录`extract.py`。非秘密配置在`../.cu-runtime/extractor-config.json`，临时目录也在本副本；本轮没有安装依赖或修改已有Python。其他机器需通过根目录`scripts/configure-yuzhou-extractor.mjs`单独探测已有运行时。OCR、扫描PDF文字识别及旧DOC/PPT不支持；未提取的内容不得补写或猜测。

## 运维边界

- SQLite 数据目录必须持久化，代码更新不可替换该目录。备份数据库时使用 SQLite 在线备份或停服复制，以保证 WAL 一致性。
- 原有前端本机数据不会自动成为云端数据，需要前端通过同步流程上传。云端接口不接受 demo 工作区。
- 单用户、多设备通过乐观版本锁保护；409 必须由客户端保留本机未同步内容并处理，不能无条件重试覆盖。
- 模型配置不在数据库工作区内；由AI服务保存在本副本私有文件，不返回Key。不得读取其他项目的Key；真实试测须使用本比赛专用Key并明确额度。
- 登录失败 8 次 / 15 分钟按直接连接来源限制，另有全局限制。默认不信任 X-Forwarded-For；单用户反向代理场景共享这一额度。
- API 没有对外发消息的集成。此服务本身不配置 QQ、微信、不开放 Hermes 管理界面。

## 测试

```
node scripts/test-yuzhou.mjs
```

在比赛根目录运行以上统一入口，或本目录执行 `npm test`。它会将TEMP/TMP限定到本副本并清除旧环境变量，运行前端、后端与移动端纯测试，保存独立时间戳报告。不要直接沿用历史 `node --test` 命令以免测试临时数据写到系统目录。测试覆盖首次注册竞态、身份验证、持久会话、暴力破解限制、CSRF、精确源检查、乐观锁、附件隐私/幂等/冲突、静态路径边界、配额及事务恢复。使用合成数据；未测试真实模型效果。

DEV-003针对直连与原AI服务的51项测试通过；备份修复6项通过。新增5项确认竞态测试后的最终全量338项中337通过、0失败、1项可选跳过。合成浏览器实际验证DOCX/PPTX/PDF正文及确认后的数据与回执；不把重复跑过的针对性测试累加为独立测试数，不把离线模型注入解释为真实模型效果。最终报告为`evidence/engineering/DEV-003-tests-2026-10-09T02-43-37-925Z.tap`。

## 在线备份

```
node yuzhou/backend/backup.mjs --data-dir yuzhou/.cu-runtime/data --output-dir yuzhou/.cu-runtime/backups
```

在比赛根目录执行。备份路径必须在数据目录之外，但仍在本副本 `.cu-runtime` 内；原生产目录、原systemd及部署脚本均不可复用。本轮仅用合成数据测试备份，没有读取或备份用户原数据库。

每次生成独立的 `yuzhou-时间-随机值/` 目录，绝不覆盖旧备份。主数据库使用 Node SQLite 在线 backup API 制作一致快照并执行 quick_check；按快照内的文件元数据复制不可变原件、核验大小及 SHA-256；AI 配置、任务记录和其独立工作目录一同保存，其中 SQLite 文件也单独在线备份。AI JSON 文件通过原子写入更新，备份会保存读取时的完整版本。文件系统记录和主数据库并非一个跨存储事务，恢复时正在执行的 AI 任务会按服务逻辑标记为中断，已保存的工作区内容仍以数据库为准。

快照带有文件校验清单。备份包含登录数据库和已配置的模型密钥，不能放到公开网站或未加密的共享目录。CLI 只输出完成路径、数量、总字节和工作区版本，不输出任何秘密。失败只清理本次创建的 `.partial` 目录，不碰旧备份。脚本不自动删除历史备份；保留期限由运维定时器按实际空间制定。

DEV-003全量测试曾发生Windows临时目录改名EPERM。现在显式等待哈希文件句柄关闭，最终发布只对Windows的EPERM/EBUSY作有限退避；每次先检查目标不存在，最多额外重试5次，不删除或覆盖已有备份。定向原版复跑未稳定重现占用，不能断言具体外部进程；真实失败报告与故障注入验证均保留。

恢复前先停止服务、另存当前数据，然后把所选备份复制到新的 DATA_DIR，校验权限与清单后切换。不要直接在唯一备份目录上启动服务，以免改变备份本身。
