# 设计系统 V2（R2-WebDAV 面板）

> 第三轮全站重构的设计规范。基于 [design-spec.md](design-spec.md)（V1）演进：**不推翻既有方向**（Flat、单强调色、无边框分层、克制动效均已验证），补全 token 缺口、组件状态矩阵与信息密度规范。
> 唯一出处仍是 `public/panel/style.css` 的 `:root`；改 token 必须同步本文件。

## 1. 设计方向

**Modern SaaS + Minimalist + Professional Cloud Storage**。

一句话定位：一个安静、精密的私有云控制台——像 Linear 一样有秩序，像 Vercel 一样让数据说话，像 Dropbox 一样让文件操作顺滑，但视觉身份是自己的：**单强调色蓝、无边框色阶分层、4–32px 间距数列、克制的 spring 微动效**。

- 记忆点（把大胆花在一处）：**存储容量横带**——32px 大数字 + 细进度条，是全站唯一的大视觉元素；其余一切保持安静。
- 禁止（与 V1 一致，并新增）：全大写 eyebrow 标签、中间点连接的元信息串、按钮尾箭头、emoji 当图标、紫色渐变、玻璃拟态、卡片套卡片、>14px 圆角、全站单一线性动效曲线。

## 2. 颜色 Token（亮/暗成对）

### 2.1 既有（不变）

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--bg` | `#f4f6f8` | `#0e1116` | 应用背景 |
| `--surface` | `#ffffff` | `#161b22` | 卡片/弹层 |
| `--surface-2` | `#eef1f5` | `#1d242e` | 次级面/hover |
| `--surface-3` | `#e3e8ef` | `#27313e` | 三级面/进度槽 |
| `--border` / `--border-strong` | `#dfe4ea` / `#c9d1dc` | `#27303c` / `#39434f` | 输入框/分隔线 |
| `--text` / `--text-2` / `--muted` | `#17202b` / `#45505e` / `#6d7887` | `#e8ecf1` / `#b3bcc8` / `#8a94a2` | 三级文字 |
| `--accent` / `--accent-hover` / `--accent-weak` / `--accent-text` | `#2563eb` / `#1d4fd8` / `#e9f0fe` / `#1d4fd8` | `#6395f7` / `#7ba4f9` / `#1c2a44` / `#8fb0fa` | 品牌强调 |
| `--ok` / `--ok-weak` | `#16803c` / `#e5f6ea` | `#57c47d` / `#14261b` | 成功/健康 |
| `--danger` / `--danger-hover` / `--danger-weak` | `#d92d20` / `#b42318` / `#fdecea` | `#f26b5e` / `#f58377` / `#331a17` | 危险/错误 |

### 2.2 新增（Batch 1 落地）

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--warning` / `--warning-weak` | `#b54708` / `#fef4e6` | `#e8a15c` / `#2e2113` | 截断统计、部分可用等"注意"态 |
| `--info` / `--info-weak` | 复用 accent 系 | 复用 accent 系 | 信息提示（不引入第二强调色，info 即 accent） |

规则：
1. 状态不允许仅靠颜色区分——`dot` 必须伴随文字，badge 必须有词。
2. 页面内禁止出现本表之外的色值；`color-mix` 只允许基于上述 token。
3. 暗色文字对比按 WCAG AA 验收（正文 ≥4.5:1，大字/粗体 ≥3:1）。

## 3. 字体与排版

系统字体栈（不引入外部字体——私有云离线可用、国内网络、零构建）：

```
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif
--mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace
```

| 角色 | 规格 |
|---|---|
| 页面标题 h1 | 19px / 650 / -0.01em |
| 卡片标题 h2 | 15px / 650 |
| 大数字（容量带） | 32px / 680 / -0.02em / `tabular-nums` |
| 统计数字 | 21px / 680 / `tabular-nums` |
| 正文/按钮 | 14px / `--fw-body`(暗色 350)；按钮 13.5px / 550 |
| 辅助说明 | 13px / `--muted` / 1.65 行高 |
| 表格内容 | 13–13.5px / 名称 530 / 元数据 12.5px `tabular-nums` |
| 表单标签 | 12.5px / 570 / `--text-2` |
| 代码/路径 | `--mono` 12.5px / `word-break: break-all` |

规则：数字列必须 `tabular-nums`；同级文字同式样；一行不超过 80 字符的正文场景仅出现在弹窗说明（实际均 < 460px 宽）。

## 4. 间距、尺寸与布局

| 项 | 值 |
|---|---|
| 间距数列 | `--space-1..6` = 4 / 8 / 12 / 16 / 24 / 32（20px 仅限卡片/弹窗水平内边距） |
| 侧栏宽 | `--sidebar-w` 228px；≤820px 变 fixed 抽屉 |
| Topbar 高 | `--topbar-h` 58px，sticky + 毛玻璃 |
| 内容宽度 | 默认 max 1080px 居中；文件视图允许延展至 1200px（V3 修复，仅 `#view-files`） |
| 视口内边距 | 桌面 24px；≤820px 16/14px |
| 列表行高 | 列表行 padding 5–6px（行高约 40px）；移动端触控行更高 |
| 圆角 | 7 / 10 / 14 三档（`--radius-s/m/l`），例外须注释 |
| 阴影 | `--shadow-1/2/3` 三档；无边框分层 |
| 触控 | coarse 指针下 icon-btn 40px、checkbox 命中区外扩 |
| Safe area | menu-sheet / tray / toasts / modal-sheet 均含 `env(safe-area-inset-*)` |

## 5. 组件规范与状态矩阵

每个交互组件必须覆盖：**默认 / Hover / Focus-visible / Active / Disabled / Loading / 成功 / 错误**（适用项）。

| 组件 | 关键规格 | 状态要求 |
|---|---|---|
| Button `.btn` | primary/ghost/danger/sm/block；按压 scale(.96)+spring | busy 用 `::before` spinner；disabled 0.55 |
| Icon Button `.icon-btn` | 34px（触控 40px）；badge 角标 | hover surface-2；focus-visible 环 |
| Input `.input` | 边框唯一保留处；focus 三向光晕 | `.invalid` 红框+shake+行内错误 |
| Select `.select-sm` | 原生 select | 同 input focus |
| Checkbox | accent 着色，coarse 外扩命中 | indeterminate 支持全选 |
| Seg `.seg` | surface-2 槽 + active 浮起 | active 有 shadow-1 |
| Menu | 无边框 + shadow-3；≤640px 变 sheet | danger 项红字红底；Esc/点外关闭 |
| Modal | 居中 ≤460px，wide 720px；≤640px Bottom Sheet | 进 ease-out / 出 ease-in 130ms；焦点圈定；表单类禁蒙层关闭 |
| Drawer | 右侧 420px 不压暗 | **V2 修复：开箱移焦 + 焦点圈定 + Esc 关闭** |
| Toast | 底部居中胶囊 2.6s，最多 4 条 | ok/error/info 图标着色；action 仅真实回调 |
| Empty/Error State | `.list-message` 图标+文案+行动按钮 | 文案说清"发生了什么+能做什么" |
| Loading | skeleton-row shimmer（列表）/ spinner（预览）/ `.btn.busy`（按钮） | reduced-motion 全退化 |
| File Row | grid `40/30/1fr/110/168/40`；hover 提亮 | **V2：选中态加左侧 accent 指示条**；操作钮 hover/focus-within 显形 |
| Grid Card | minmax(108px,1fr) | hover 提亮+微影；kebab hover 显形（触控常显） |
| Breadcrumb | 可点段落+当前段 | 横向滚动自动吸尾 |
| Progress Bar | 8px 圆槽 + accent 填充 | 宽度 transition 0.25s |
| Status Badge | 胶囊 `.badge(.ok/.bad/.warn)` | **V2 新增 `.warn` 配对 warning token** |
| Tooltip | 原生 title（轻量原则，不引入 JS tooltip） | — |

## 6. 动效

- 移动/遮罩/抽屉用 `--ease-smooth`；按压回弹等确认类用 `--ease-spring`；出现 ease-out、退出 ease-in；时长 0.12–0.25s。
- 非用户触发的动效只在两处出现：骨架屏 shimmer、dot 健康光晕。禁止页面加载入场动画序列。
- `prefers-reduced-motion` 下全部退化（现有 `*` 兜底保留）。

## 7. 文案

- 按钮写动作不写"是/否"；错误说具体问题+可能原因（沿用 `api.js` ERROR_MAP 中文映射）。
- 同一动作全流程同名（"删除"按钮 → "已删除" toast）。
- 空态是行动邀请（"此文件夹为空 → 上传文件/新建文件夹"）。
- 禁止装饰性文案与营销语气；单用户工具的语气是平静的技术说明。
- **异步状态文案必须诚实**：不暗示不存在的能力——上传暂停提示写明"刷新页面后需重新上传"（架构不支持跨页面续传），进度条注明额度来源与封顶行为。

## 8. 变更流程（与 V1 一致）

改 token / 组件形态 → 同步本文件与 design-spec.md → `npm run check && npm test` → Playwright 双主题 × 双端矩阵过一遍。
