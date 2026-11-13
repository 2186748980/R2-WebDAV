# 设计规范（R2-WebDAV 面板）

> 面板的视觉与交互决策集中在这里。改样式前先读本文件；改完 token 必须同步本文档。
> 配套文件：[development-rules.md](development-rules.md)（工程规则）。

## 1. Token（唯一出处：`public/panel/style.css` 的 `:root`）

| 类别 | Token | 值 | 说明 |
|---|---|---|---|
| 颜色 | `--accent` | `#2563eb`（暗色 `#6395f7`） | 全站唯一强调色，禁止第二强调色、禁止紫色渐变 |
| 颜色 | `--surface / --surface-2 / --surface-3` | 见 `:root` | 分层靠微对比色阶 + 阴影，**外形边框已全部移除** |
| 间距 | `--space-1..6` | 4 / 8 / 12 / 16 / 24 / 32 px | 新代码必须落在这组数列上；**20px 为批准例外**（卡片/弹窗水平内边距），26/22/18/14 等离群值已收敛 |
| 圆角 | `--radius-s / m / l` | 7 / 10 / 14 px | 全站只用这三档；例外必须写注释 |
| 字重 | `--fw-body` | 400（暗色 350） | 暗色正文调细一档；标题/按钮保持各自显式字重 |
| 动效 | `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | 位移、遮罩、抽屉等"移动类" |
| 动效 | `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 按压回弹等"确认类"微交互 |
| 动效 | 时长 | 0.12–0.25s | 出现用 ease-out，退出用 ease-in；禁止全站单一线 |

## 2. 组件形态

- **分层规则（第二轮起）**：卡片/弹窗/抽屉/菜单/Toast 一律**无边框**，靠 `bg → surface → surface-2` 色阶 + `--shadow-2/3` 浮起；边框只保留给输入框（`.input/.search-box`）与功能性分隔线（表头/工具栏/列表行）。`.grid-card` 用 surface-2 底在 surface 卡内再分层。
- **概览页层次（非对称）**：① 状态横幅（健康点+服务器地址+快捷操作同行）→ ② 存储容量横带（32px 大数字 + 免费额度 10 GB 进度条）→ ③ 账号/安全次要双列。禁止回到均等 2×2。
- **文件页**：视图 flex 全高，列表卡撑满视口、卡内滚动；短目录不留下方死空间。
- **弹窗（modal）**：居中白框，桌面 `max-width: 460px`，预览类 `wide` 720px；≤640px 自动变 Bottom Sheet。
- **右侧抽屉（drawer）**：详情等"查阅型"内容用 `#drawer`，不压暗背景，Esc / 点外 / 切视图关闭。
- **确认弹窗**：小弹窗；按钮文案写动作（"删除""全部删除"），禁止"是/否"；批量删除确认必须列出实际目标（`detail`）。
- **表单弹窗**：`dismissOnBackdrop: false`——蒙层点击永不关闭，防草稿丢失。
- **Toast**：底部居中、2.6s、最多 4 条；反馈必须具体。`toast(msg, kind, { action })` 支持 action 按钮——**仅在传入真实 `onClick` 回调时渲染**（如搜索失败→重试），禁止装饰性按钮。
- **反馈底线**：所有用户操作（下载、搜索、删除、上传）必须有开始/成功/失败三态反馈，禁止静默。

## 3. 动效规则

- 出现 ease-out，退出 ease-in（`modal-out` / `fade-out`，时长与 `dialogs.js` 的 130ms 清理同步）。
- 按压 `scale(0.96)` + spring 回弹；禁止只做 `translateY`。
- 输入错误：红框 + 行内文字 + `shake` 轻晃 + 提示滑入。
- 加载：列表用 skeleton-row（shimmer），旋转用 linear。
- `prefers-reduced-motion` 下所有动画必须退化（现有 `* { animation-duration: 0.01ms }` 兜底 + JS 的 `REDUCED` 分支）。

## 4. 文案

- 错误信息说具体问题与可能原因（见 `api.js` 的 `ERROR_MAP`；搜索空结果要提示搜索范围）。
- 同一级文字同一式样；数字用 `tabular-nums` 防抖动。

## 5. 变更流程

改任何 token / 组件形态 → 同步本文件 → `npm run check && npm test` → 真机过一遍移动端（≤640px）与暗色两套组合。
