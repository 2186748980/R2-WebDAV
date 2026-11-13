# 开发规则（R2-WebDAV）

> 工程决策与红线集中在这里。写代码前先读；改规则必须同步本文档。
> 配套文件：[design-spec.md](design-spec.md)（设计规范）。

## 1. 架构

- **后端**：`src/worker.js` 单文件 Cloudflare Worker（WebDAV + 面板 API + 分享 + 静态资源）。无框架、无构建步骤。
- **前端**：`public/panel/`，原生 ES Modules。`app.js` 只做编排（登录/导航/主题），业务在 `js/files.js`（文件列表）、`js/item-actions.js`（下载/预览/详情/分享等单项操作）、`js/uploads.js`（上传）、`js/dialogs.js`（弹窗/抽屉）、`js/ui.js`（工具/Toast）、`js/api.js`（API 层）、`js/icons.js`（内联 SVG 图标）。
- 图标只允许来自 `icons.js` 的 `PATHS`，名字只来自代码，禁止用户数据拼 SVG。

## 2. 安全红线

- 密钥只存在于 Worker Secrets（`WEBDAV_USERNAME` / `WEBDAV_PASSWORD`）；前端不存密码（仅 `api.js` 模块变量，随标签页死亡），不进 localStorage / URL / 日志。
- 分享签名密钥 = `WEBDAV_PASSWORD` 本身；改密码旧链接、旧会话一起失效（这是特性，不是缺陷）。
- 分享响应禁止 `text/html` / `image/svg+xml` / `xhtml` 内联（防存储型 XSS）——`handlePublicShare` 里已有过滤，动下载逻辑时不得绕过。
- 路径校验唯一入口：`panelPathToKey` / `unsafePath`；新端点必须先过校验再碰 R2。
- 上传 Content-Type 兜底走 `resolveContentType`（请求头缺失或 octet-stream 时按扩展名推断）；显式指定的具体类型永远优先。

## 3. 前端约定

- 弹窗只用 `dialogs.js` 的 `showModal / formDialog / confirmDialog / showDrawer`，禁止再发明弹层。
- 所有列表刷新走 `openPath(state.path)`；`render()` 是唯一渲染入口，消息态只经 `renderMessage`。
- 反馈：`toast()` 必须带具体对象；下载走 `downloadFile()`（blob 反馈，>512MB 退化为浏览器直下）。
- 状态标志：`loading`（列目录）、`searching`（全局搜索）都会驱动骨架屏，新增异步态照此模式。
- DOM 节点通过 `el()` 创建，等价于 JSX 的最低配；别用 `innerHTML` 拼用户数据。

## 4. 测试与验证

- `npm run check`：语法门禁（9 个文件全查，含 item-actions.js）。
- `npm test`：`test/worker.test.mjs`，95+ 断言（面板入口、API、multipart、分享、WebDAV 方法、Range、穿越防护、file/download 的 HEAD 探测、对象 CSP）。**改 worker 必须跑，改前端也要跑**（覆盖 API 契约）。
- 真机检查点（门禁绿 ≠ 完成）：移动端 Bottom Sheet、暗色模式、上传暂停/续传。
- 部署后验收靠 CI 的 `verify-deployment`；本机不通 workers.dev，不要在本机 curl 线上。

## 5. 部署

- README 配置了 Cloudflare Workers Builds（push 后自动构建）；`npm run deploy`（wrangler deploy + verify）是手动通道。
- CI 的 `verify-deployment` 只做线上验收，不部署。若怀疑线上版本落后 main：先在 Cloudflare 控制台查 Workers Builds 构建历史，再决定手动 deploy；本机不通 workers.dev，不要在本机 curl 线上。
- 红线：不动 Secrets、不动 R2 数据、不挪 `/dav` 路径。

## 6. Git

- 提交信息用 conventional commits（`fix(panel):` / `feat(panel):` / `chore(ci):`）。
- 每个可独立回退的改动一批；文档与代码同批进。
