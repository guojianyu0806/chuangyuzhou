# 宇宙私人云后端 0.2.2

Node.js 22.13+（部署建议采用受支持的 Node 22 或 24 版本），使用内置 HTTP、SQLite 和密码学模块。没有 npm 运行依赖。Node 22 的 SQLite 模块可能输出实验性功能提示。

## 启动

```
node backend/server.mjs
```

由 systemd 或其他服务管理器设置环境变量：

| 环境变量 | 含义 |
| --- | --- |
| `HOST` | 默认 `127.0.0.1`；保留回环绑定，由 HTTPS 反向代理对外服务 |
| `PORT` | 默认 `4180` |
| `DATA_DIR` | 独立于代码发布目录的持久私有目录；目录 0700，数据库和附件 0600 |
| `FRONTEND_DIR` | 前端目录；默认相邻 `frontend/` |
| `PUBLIC_ORIGIN` | 唯一 HTTPS 访问源，例如 `https://workbench.example`，不能包含子路径 |
| `SETUP_TOKEN_FILE` | 首次注册凭据文件路径；Unix 权限必须 0600 或更严格 |
| `SECURE_COOKIE` | 默认开启；仅回环开发环境可以设为 `false` |

初始管理员通过注册页面输入部署时生成的随机 setup token、自选用户名及至少 12 字符的密码。仅允许创建一个账号；账号创建和关闭注册在同一 SQLite 事务中完成。部署后可移除 setup token 文件和配置项；现有账号仍可正常登录。不要把 setup token、密码或模型 key 放进前端代码、Git、日志或公开交付文档。

所有写请求必须提供与 `PUBLIC_ORIGIN` 完全一致的 `Origin`。已登录写请求还必须包含 `X-CSRF-Token`，从登录响应或 `/api/auth/session` 获取。开发环境未设置 `PUBLIC_ORIGIN` 时只接受当前回环源。

## API

- `GET /api/health`：公开最小服务状态。
- `GET /api/auth/session`：登录和初始化状态；登录后返回 CSRF token。
- `POST /api/auth/setup`：`{username,password,setupToken}`，仅首次可用。
- `POST /api/auth/login`、`POST /api/auth/logout`：持久登录会话，HttpOnly / SameSite=Strict / Secure cookie。
- `GET /api/workspace`：`{revision,state,updatedAt}`。
- `GET /api/workspace?since=revision`：版本未变仅返回 `{revision,unchanged:true}`，改变后才返回完整数据；用于多设备轮询，减少有限带宽开销。
- `PUT /api/workspace`：`{baseRevision,state}`；只接受 schema 1 的 personal 工作区，大小 12 MiB，版本冲突返回 409。当前版本和最近 20 个旧版本保存在 SQLite。文件引用必须已上传成功。
- `PUT /api/files/:id`：原始二进制，40 MiB 上限；`Content-Type` 与 `X-File-Name: encodeURIComponent(name)`。同一 ID 相同字节可重复上传，不同内容返回 409。
- `GET /api/files/:id`：登录后下载，attachment / nosniff / sandbox / no-store。
- `HEAD /api/files/:id`：检查远端附件，返回 Content-Length、ETag（SHA-256）、X-File-Name。
- `/api/model/*`、`/api/ai/*`：交给相邻 `hermes.mjs` 模块；服务先统一检查身份、来源、CSRF。

附件 ID 允许 1–128 位 ASCII 字母、数字、下划线及短横线，以字母数字开头。兼容浏览器生成的 UUID。默认附件存储总上限 10 GiB。删除工作区条目不会立即删除原件，避免恢复和并发同步造成文件损失；清理功能需后续按引用和历史保留规则实现。

静态资源仅开放 `/`、index、icon、manifest 和 `src/` 下允许的资源类型，测试、README、隐藏文件、私有数据及代码目录外符号链接均不可访问。

## 运维边界

- SQLite 数据目录必须持久化，代码更新不可替换该目录。备份数据库时使用 SQLite 在线备份或停服复制，以保证 WAL 一致性。
- 原有前端本机数据不会自动成为云端数据，需要前端通过同步流程上传。云端接口不接受 demo 工作区。
- 单用户、多设备通过乐观版本锁保护；409 必须由客户端保留本机未同步内容并处理，不能无条件重试覆盖。
- 模型配置不在数据库工作区内；由 Hermes 适配器保存在私有文件，不返回 key。
- 登录失败 8 次 / 15 分钟按直接连接来源限制，另有全局限制。默认不信任 X-Forwarded-For；单用户反向代理场景共享这一额度。
- API 没有对外发消息的集成。此服务本身不配置 QQ、微信、不开放 Hermes 管理界面。

## 测试

```
node --test backend/tests/*.test.mjs
```

集成测试使用独立临时目录和临时端口，覆盖首次注册竞态、身份验证、持久会话、暴力破解限制、CSRF、精确源检查、乐观锁、附件隐私/幂等/冲突、静态路径边界、配额及事务恢复。不会接触用户浏览器或真实服务器数据。

## 在线备份

```
node backend/backup.mjs --data-dir /var/lib/shiguang --output-dir /var/backups/shiguang
```

也可使用 `DATA_DIR` 和 `BACKUP_DIR` 环境变量。备份路径必须在数据目录之外。运行账号需要读取私有数据、写入备份目录的权限；生产环境可由 root 的 systemd timer 执行，整个备份目录保持 0700、文件保持 0600。

每次生成独立的 `yuzhou-时间-随机值/` 目录，绝不覆盖旧备份。主数据库使用 Node SQLite 在线 backup API 制作一致快照并执行 quick_check；按快照内的文件元数据复制不可变原件、核验大小及 SHA-256；AI 配置、任务记录和其独立工作目录一同保存，其中 SQLite 文件也单独在线备份。AI JSON 文件通过原子写入更新，备份会保存读取时的完整版本。文件系统记录和主数据库并非一个跨存储事务，恢复时正在执行的 AI 任务会按服务逻辑标记为中断，已保存的工作区内容仍以数据库为准。

快照带有文件校验清单。备份包含登录数据库和已配置的模型密钥，不能放到公开网站或未加密的共享目录。CLI 只输出完成路径、数量、总字节和工作区版本，不输出任何秘密。失败只清理本次创建的 `.partial` 目录，不碰旧备份。脚本不自动删除历史备份；保留期限由运维定时器按实际空间制定。

恢复前先停止服务、另存当前数据，然后把所选备份复制到新的 DATA_DIR，校验权限与清单后切换。不要直接在唯一备份目录上启动服务，以免改变备份本身。
