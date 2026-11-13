# UI/UX 全站审计（第三轮重构基线）

> 生成于 2026-11-09，第三轮全站重构的 Batch 0 产物。
> 前两轮成果见 [design-spec.md](design-spec.md) / [development-rules.md](development-rules.md)，本审计在其基础上做全站盘点。

## 0. 工作区状态（保护方案的前提）

| 项 | 状态 |
|---|---|
| 分支 / HEAD | `main` @ `82cff2b`（menu a11y roles） |
| origin/main | 本地 ref 指向 `438c058`，**本地领先 1 提交未推送**；GitHub 实时核验失败（502×2，网络不可达），以本地 ref 为准 |
| 未提交修改 | **9 个文件 +578/−141**：`README.md`、`public/panel/{app.js,index.html,style.css}`、`public/panel/js/{dialogs,files,icons,ui}.js`、`src/worker.js` —— 即前两轮 UI 成果本体，**一行都不能丢** |
| 未跟踪目录 | `docs/`（design-spec.md、development-rules.md）、`.mimosa/`（安全扫描状态，禁止触碰） |
| worker.js 未提交内容 | MIME 类型推断（`resolveContentType` + `MIME_BY_EXT`）+ list/search 的 `contentType: null` 语义 —— 属于第二轮成果，本次重构**完全不碰 worker.js** |

**保护方案**：
1. 全程不执行任何 git 写操作（commit/push/checkout/reset/clean/stash 全禁）。
2. 只修改 `public/panel/` 下的前端文件；`src/worker.js`、`wrangler.jsonc`、Secrets、R2、`/dav` 路径零接触。
3. 每个批量编辑前先读原文件，改完跑 `npm run check && npm test`（88+ 断言）作为回归门禁。
4. 需要回滚时只回滚本轮新增改动（本轮改动与工作区已有改动可按文件边界区分：本轮之前已修改的 9 文件在 git diff 中已有内容，本轮新增部分以本轮的编辑记录为准）。
5. `npm run check` 的 8 个文件里 7 个是前端 —— 前端改动后必须过。

## 1. 页面与功能清单（实际盘点）

> 任务书中的"分享管理"在真实产品中**不是独立页面**：单用户模型下分享是无状态的临时 HMAC 链接（菜单 → 分享弹窗生成，无列表）。测试矩阵中的"分享管理"映射为分享弹窗流程。"文件详情"= 右侧 Drawer，"文件预览"= 宽版 Modal。

| # | 页面/组件 | 入口 | 实现位置 |
|---|---|---|---|
| 1 | 登录页 | 未认证 / 会话失效 | `index.html` #login + `app.js` |
| 2 | 概览 Dashboard | 导航"概览" | `app.js` loadOverview + #view-overview |
| 3 | 文件管理 | 导航"文件" | `files.js`（900 行）+ #view-files |
| 4 | WebDAV 连接页 | 导航"WebDAV" | #view-webdav + loadWebdav |
| 5 | 设置页 | 导航"设置" | #view-settings + renderCredentials |
| 6 | 文件详情 Drawer | 行菜单"详情" | `files.js` showDetails + `dialogs.js` showDrawer |
| 7 | 文件预览 Modal | 点文件名 / 菜单"预览" | `files.js` previewItem（图片灯箱/视频/音频/PDF/文本） |
| 8 | 分享弹窗 | 文件菜单"生成分享链接" | `files.js` shareItem |
| 9 | 上传系统 | 上传按钮/拖拽 | `uploads.js`（分片、暂停/续传、覆盖确认、Tray） |
| 10 | 全局交互层 | — | `dialogs.js`（modal/drawer/form/confirm）、`files.js`（menu/sheet）、`ui.js`（toast）、drop-overlay、global-hint、batch-bar |

## 2. 前两轮成果盘点（必须保留的部分）

以下为已验证不可回归的能力，重构时逐项对照：

1. **概览非对称三级层次**：状态横幅 → 存储容量横带（32px 大数字 + 10GB 免费额度进度条，注明来源）→ 次要双列。
2. **文件页全高布局**：`#view-files` flex 全高，列表卡撑满视口、卡内滚动。
3. **无边框分层**：卡片/弹窗/抽屉/菜单/Toast 无边框，靠 surface 色阶 + 阴影浮起；边框只留输入框与功能性分隔线。
4. **间距数列** 4/8/12/16/24/32（20px 为卡片/弹窗水平内边距的批准例外）。
5. **Toast Action**：仅传真实 `onClick` 回调时渲染（搜索失败→重试）。
6. **批量删除确认**：确认弹窗列出实际目标清单（`detail`）。
7. **CSP/nosniff**：分享响应安全头（worker 侧，不触碰）。
8. **移动端触控区**：`pointer: coarse` 下 icon-btn 40px、勾选区外扩。
9. **主题 FOUC 修复**：首帧前设 `data-theme` + theme-color 同步；`prefers-color-scheme` 兜底。
10. **Bottom Sheet**：≤640px 弹窗/菜单变底部面板，含 safe-area。
11. **MIME 兜底**（worker，未提交）：上传无类型时按扩展名推断。
12. **密码内存态**：仅模块变量，不落任何存储。
13. **骨架屏/空态/错误态**：列表三态齐备，含具体行动按钮。
14. **上传覆盖确认**：同名文件先弹确认（跳过/覆盖）。
15. **a11y 基线**：focus-visible 环、aria-label、role=list/listitem/menu/menuitem、焦点圈定（modal）、Esc 关闭。

## 3. 问题清单

### 3.1 视觉与信息架构

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| V1 | Topbar 全大写 eyebrow（"OVERVIEW"）是 frontend-design 点名的"生成页通病"，且占两行高度稀释标题 | `app.js` VIEWS + topbar | 中 |
| V2 | 概览"账号"卡与 hero 信息重复（R2 状态两处出现），"安全"卡文案密度高、无行动点 | #view-overview | 中 |
| V3 | 内容最大宽度 1080px 对文件管理偏窄，1920px 下浪费；但概览/设置页 1080 合理 | `.main > .view` | 低 |
| V4 | 文件行 hover 高亮与选中态只用背景色区分，无左侧指示 | `.file-row` | 低 |
| V5 | 网格卡信息层级弱（meta 行 size 与 date 并列但仅文件有 date） | `buildGridCard` | 低 |
| V6 | 设置页 kv 行均质无组内差异，"服务信息"是静态枚举表格化不足 | #view-settings | 低 |
| V7 | 登录页 radial 渐变背景偏装饰，hero/第一印象一般 | `.login` | 低 |

### 3.2 交互

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| I1 | Drawer 打开不移焦、无焦点圈定（modal 有）——键盘用户失焦到页面底层 | `showDrawer` | 高（a11y） |
| I2 | 文件区无键盘操作（无 Ctrl+A 全选、无方向键导航） | `files.js` | 低 |
| I3 | 搜索框 Enter=全局搜索仅由 placeholder 提示，移动端软键盘无"搜索"键语义（非 search type） | `searchInput` | 低 |
| I4 | 面包屑滚动 `scrollLeft=scrollWidth` 无滚动视觉提示 | `renderBreadcrumb` | 低 |
| I5 | `refreshBtn` 在概览/文件页语义不同（files→刷新列表，其他→刷新概览），WebDAV/设置页刷新无效果 | `app.js` | 低 |

### 3.3 工程

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| E1 | `files.js` 900 行承载列表+菜单+预览+详情+分享五类职责 | `files.js` | 中 |
| E2 | `style.css:414` 缩进异常（tab 混入）——纯格式 | style.css | 低 |
| E3 | 图标集无 `folder-open` 等状态差异图标（面包屑 home 可接受） | icons.js | 低 |

### 3.4 桌面端专项

- 1366px：正常；文件列表 1fr 名称列充分。1920px：内容 1080 居中，两侧大留白（V3）。1440px：正常。
- 表格列宽 `110px/168px` 固定，日期完整显示"2026/11/08 14:30"；更宽屏可放宽 date 列。
- 无横向滚动问题（列表内部滚动已就位）。

### 3.5 移动端专项（≤640px / Android Chrome）

- 布局独立策略已就位（隐藏 size/date 列、4 列网格、Bottom Sheet、菜单 sheet、tray 全宽、toast 顶部 safe-area）。
- 遗留风险：软键盘弹起时 Bottom Sheet 表单（新建/重命名）的可用性依赖浏览器滚动行为，`overscroll-behavior: contain` 已设，需真机确认。
- 触控命中区已达标（coarse 指针 40px）。

## 4. 回归风险清单

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| API 契约破坏 | 改 `api.js` 参数/字段 | 不改 `api.js` 的请求契约；只读调用 |
| 事件绑定丢失 | 改 DOM 结构后选择器失配 | 改前记录关键 ID（见 §5）；改后 Playwright 回归 |
| 88+ 断言变红 | 前端资源被测试扫描（面板入口断言读 public/panel） | 每批改完跑 `npm run check && npm test` |
| 主题 FOUC 复发 | 动 head 内联脚本 | 该脚本与 `style.css` token 一起锁定 |
| 移动端 Bottom Sheet 回归 | 改 modal/menu 的 ≤640px 规则 | Playwright 375px 视口矩阵 |
| 拦截器误报 | Mimosa hook 拦 git commit | 本轮不 commit；如需提交由用户在 ZCode 外执行 |

## 5. 受保护的关键 DOM/选择器契约

重构中如需改动 DOM，以下 ID/选择器被 JS 直接依赖，**改名必须同步 `*.js`**：

- `#login #loginForm #loginUser #loginPass #revealPass #loginError #loginSubmit`
- `#app #sidebar #backdrop #menuBtn #logoutBtn #logoutBtn2`
- `#pageTitle #pageEyebrow #trayBtn #trayBadge #themeBtn #refreshBtn #themeSeg [data-theme-mode]`
- `#view-overview #view-files #view-webdav #view-settings`、`.view`、`.nav-item[data-nav]`、`[data-goto]`、`[data-copy]`
- 概览：`#healthDot #healthText #r2Badge #serverUrl #statBytes #statFiles #statFolders #statsScope #storageFill #statsNote #username #r2Status #sessionUser #credUsername #settingsUrl`
- 文件：`#breadcrumb #itemSummary #searchInput #sortSelect #viewToggle [data-mode] #newFolderBtn #uploadBtn #globalHint #batchBar #selCount #batchCopy #batchMove #batchDelete #clearSel #listHead [data-sort] .sort-ind #selectAll #fileList #listState #loadMoreBtn`
- WebDAV：`#davUrl #panelUrl #username2 #copyConfigBtn`
- 设置：`#credPassword #togglePasswordBtn #copyPasswordBtn`
- 全局：`#dropOverlay #tray #trayList #trayClose #menu #modal #drawer #toasts #fileInput`
- 类契约：`.modal-box(.wide)(.danger)`、`.modal-head/body/foot`、`.drawer/.drawer-head/body/foot`、`.menu(.sheet)`、`.toast(.ok/.error/.info) .toast-action`、`.file-row .grid-card .cell-*`、`.skeleton-row`、`.list-message .message-*`、`.kv`、`.seg`、`.badge(.ok/.bad)`、`.field .input .form-error .field-hint .progress-line .adv-details`、`.preview-*`、`.tray-*`、`.crumb(.current)`、`.global-hint`、`.batch-bar`、`.share-result`、`.dup-list`、`.confirm-message`

## 6. 五个 Skills 的使用记录与职责分工

| Skill | 读取 | 实际使用 | 结论 |
|---|---|---|---|
| frontend-design | ✅ 全文 | 视觉方向仲裁 | 指认 V1（eyebrow 通病）、V7（装饰渐变）；"把大胆花在一处"原则约束本方案 |
| frontend-ui-engineering | ✅ 全文 | 组件/状态/a11y 工程标准 | I1 焦点管理缺口；空/错/载三态清单沿用其标准 |
| ui-ux-pro-max | ✅ 全文 + 实际调用 search.py | 设计系统检索 | `--design-system` 返回主色 #2563EB（与现有 accent 一致，收敛）；Flat/双主题/避免过度装饰与现方向一致；ux 域确认移动端表格→卡片布局路线（已实现）；color 域结果为通用调色板，仅作参考不采纳具体色值 |
| web-design-guidelines | ✅ 全文 | 运行时规范拉取 | **拉取失败**（WebFetch TLS 证书链失败 + curl 两次返回 0 字节，代理吞包）——如实记录；回退使用 frontend-ui-engineering 的 a11y 清单 + ui-ux-pro-max 优先级表执行同目标检查 |
| webapp-testing | ✅ 全文 | Playwright 验收方法论 | 采用侦察→行动模式 + networkidle 等待；with_server.py 不适用（wrangler dev 由 Node22 独立管理） |

**分工裁决**：frontend-design 定方向与取舍，ui-ux-pro-max 提供数据支撑与清单，frontend-ui-engineering 把关组件工程与 a11y 实现，web-design-guidelines 的检查目标并入 frontend-ui-engineering 验收清单，webapp-testing 负责最终 Playwright 矩阵。不重复建第二套设计系统——design-system-v2.md 是 design-spec.md 的演进版，不是另起炉灶。

## 7. 重构路线图（批次与范围）

- **Batch 1 全局框架**：Topbar 去 eyebrow 单行化、侧栏导航精修、token 补全（warning/info/success 语义色）、基础组件状态补全（focus/disabled/active）。
- **Batch 2 Dashboard**：消除信息重复，hero 聚焦状态+地址+主操作；容量带保留；账号/安全卡改为有行动点的信息卡。
- **Batch 3 文件管理**：行选中态增强（左侧指示条）、网格卡信息层级、列宽响应式、键盘全选（Ctrl+A）、刷新语义统一。
- **Batch 4 详情与预览**：Drawer 焦点管理修复（I1）、详情信息架构（主信息+高级信息分组）、预览头信息增强。
- **Batch 5 分享与设置**：分享结果态强化、设置页分组视觉、服务信息表格式化。
- **Batch 6 登录与全局交互**：登录页背景克制化、全局组件状态核对（hover/focus/disabled/busy）。
- **Batch 7 验收**：`npm run check && npm test` + Playwright 页面矩阵（7 页 × 桌面/移动 × 亮/暗）+ 功能回归 + 截图。

**明确不做**：新增分享列表页（无后端）、回收站（无后端）、虚拟滚动（规模不需要）、引入字体/框架依赖（私有云、国内网络、零构建原则）。

---

## 8. 收尾轮附录（2026-11-09 第二批）

审计 §3 问题清单的最终处置：

| 编号 | 处置 |
|---|---|
| V1 eyebrow | ✅ 已修（Batch 1，Topbar 单行） |
| V2 概览信息重复 | ✅ 已修（Batch 2，双卡重构） |
| V3 内容宽度 | ✅ 已修（Batch 3，文件视图 1200px） |
| V4 选中仅色差 | ✅ 已修（Batch 3，左侧指示条） |
| V5 网格卡层级 | ✅ 已修（Batch 3，两行截断） |
| V6 设置均质 kv | ✅ 已修（Batch 5，spec-grid） |
| V7 登录渐变 | ✅ 已修（Batch 6，纯色背景） |
| I1 Drawer 焦点 | ✅ 已修（Batch 4，移焦/圈定/还焦） |
| I2 键盘操作 | ✅ 部分修（Ctrl+A 全选；方向键导航未做，收益低） |
| I3 搜索键语义 | ⚠️ 保留（原生 type=search 会引入清空按钮样式差异，收益低） |
| I4 面包屑滚动提示 | ⚠️ 保留（自动吸尾已满足主路径） |
| I5 刷新语义 | ✅ 已修（Batch 3） |
| E1 files.js 过大 | ✅ 已修（拆分 item-actions.js，900→646 行） |
| E2 CSS 缩进 | ✅ 已修 |
| E3 图标状态差异 | ⚠️ 保留（folder-open 收益低） |

新增处置（收尾轮）：HEAD 探测路由（旧 P2）✅ 已修；CSP form-action ✅ 已修；上传暂停诚实文案 ✅ 已补。审计期未发现的两个运行时 bug（登出后无法重登、移动端重复点导航抽屉卡死）已在第三轮 Batch 4/7 修复并回归。
