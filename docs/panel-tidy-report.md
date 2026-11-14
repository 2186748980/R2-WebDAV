# R2-WebDAV 面板整理 — 自查报告

> 2026-11-14。按《面板整理执行指令》执行。验证环境：本地 wrangler dev（127.0.0.1:8787，与 main 同代码热加载）+ Playwright；本轮验证套件 **26/26 通过 + 批量回归 2/2，零应用控制台错误**（tidy_verify.py / tidy.log）。

## 0. 关键前置发现（影响全任务的判定）

**线上部署落后于 main。** 逐文件 hash 对比（2026-11-14 实测）：`app.js`（live 12705B vs main 14103B）、`style.css`（29207 vs 36105）、`index.html`（13582 vs 14740）全部不同；按 git 历史体积定位，**线上 = `82cff2b` 时代（即 b3f22ef..438c058 版本），三轮 UI/UX 重构的三个提交（130bfb1/e741507/b32ef2d）从未部署**。旁证：b32ef2d 的 commit status 卡在 pending、无 Cloudflare Workers Builds 回写（GitHub Actions 的 test/verify-deployment 两个 check 是绿的，但 verify 只断言线上行为结构，不能证明版本）。

因此任务书中"2026-11-14 线上实测/复现"的现象（2×2 总览、空状态残留、筛选计数、P1-10 wide 失效、P1-11 无时间、P1-12 空白大）**全部是旧版行为**；其中大部分在 main 已修复。P0-1 的判断被证实："先同步部署版本再说"。

**部署同步需要您操作**（本机无 CF 凭据，见 §5 三选项）。

四份参考文档（《AI做网页APP开发规范.md》《R2面板优化建议.md》《R2面板规范审计.md》《R2登录页优化建议.md》）**未在本机找到**（全盘搜索无果）——本报告按任务书内嵌条目与验收标准执行；若文档有额外要求请补充给我。

## 1. 逐条验收

### P0（跑不通的）

| 条 | 状态 | 改动 | 验证 |
|---|---|---|---|
| P0-1 全局搜索 | ✅ 关闭（无需改码） | 无 | 链路确认可用 + 本地 26/26 套件含搜索用例；线上不可用系版本落后，同步部署后即一致 |
| P0-2 空状态残留 | ✅ 本轮修复（main 上真实存在） | `files.js:396` clearSearch——全局搜索后清除改为 `openPath(state.path)` 重载目录（搜索结果替换过 items，重渲染只会把残留搜索结果冒充目录）；纯目录筛选仍走轻量 render | PASS："Esc after empty search restores root listing（rows≥1 + state 隐藏）"、"after refresh no empty-state residue"；列表/网格双视图回归过 |
| P0-3 筛选计数 | ✅ 已在 main（b32ef2d） | 无需改 | PASS："匹配 2 / 已加载 7 项"（shown.length） |
| P0-4 视频 MIME | ✅ 已在 main（e741507）+ 本轮实测 | 无需改 | 本地实测：新上传 `mime-probe.mp4` → 响应头 `video/mp4` PASS。**诚实边界**：修复作用于新写入对象；已存的 octet-stream 旧对象（如 x.mp4）需重传一次才会带正确类型 |
| P0-5 键盘挡住登录按钮 | ✅ 本轮修复（**真机待验**） | `index.html:5` viewport 加 `interactive-widget=resizes-content`；`style.css:328` `.login` 100dvh→**100svh** + 小屏 top 锚定（`flex-start` + safe-area padding）；`app.js:124-126` focusin 时提交按钮 `scrollIntoView({block:"nearest"})` | 布局部分 PASS（390px：top 锚定 ✓、卡片 bottom=501 完整在折叠内 ✓）；**软键盘行为需真机**（见 §3） |
| P0-6 键盘弹出卡片跳变/残影 | ⏸ 按指令先复现再定根因 | 仅随 P0-5 固定布局高度（svh+top 锚定消除 dvh 反复重算） | 本地无软键盘无法复现；**待真机按验收标准测 5 次**，若仍有残影再查 transform/will-change（当前 login-card 无 transform 常驻，仅入场动画一次性） |

### P1（体验）

| 条 | 状态 | 改动 | 验证 |
|---|---|---|---|
| P1-1 登录输入 16px 防 iOS 缩放 | ✅ 本轮修复 | `style.css:363` `.login .input { font-size:16px }`（仅登录页） | PASS：computed 16px；iOS 真机缩放行为待验 |
| P1-2 触摸目标 | ✅ 本轮修复 | `style.css:365` 登录按钮 min-height 48px；`style.css:252-256` 眼睛按钮 44×44（图标不变，输入框 padding-right 52px 避让） | PASS：computed 48px；bounding box 44×44 |
| P1-3 enterkeyhint | ✅ 本轮修复 | `index.html:39,44` next/go；`app.js:115-120` 用户名 Enter→密码框（浏览器不自动跳） | PASS：Enter 后 activeElement=loginPass；键盘键帽样式需真机看 |
| P1-4 提交转圈 | ✅ 本轮修复 | `app.js:141-142,163-164` 提交加 `.busy`（复用既有 `::before` spinner），finally 移除 | PASS：提交瞬间 busy class 存在；失败恢复"登 录" |
| P1-5 分字段空提交校验 | ✅ 本轮修复 | `app.js:101-112` loginFieldError（复用 `.input.invalid` 红框+shake）；`:138-143` 只缺用户名→用户名框红框+"请输入用户名"，两个都空才通用提示 | PASS：only-username / only-password 两用例各自精准标红 |
| P1-6 登录入场动效 | ✅ 本轮修复 | `style.css:350-355` login-in 0.2s ease-smooth（opacity+8px 上移），reduced-motion 全局退化兜底既有 | PASS：computed animationName=login-in |
| P1-7 忘记密码指路 | ✅ 本轮修复 | `index.html:53` 第二行 login-foot："忘记密码？在 Cloudflare Worker Secret 中修改 WEBDAV_PASSWORD，旧会话与分享会同时失效" | PASS：文本存在；未做"找回密码"功能（按指令） |
| P1-8 弹窗多样化 | ✅ 本轮修复（克制版） | `dialogs.js:17` showModal 增 `compact`；`dialogs.js:350` confirmDialog 用 compact；`style.css` `.compact` 400px + `.danger h3` 红标题；遮罩 0.5→0.45 | PASS：确认弹窗 400px + danger 标题 rgb(217,45,32)；表单 460 / 预览 720 各自成型，一眼可分 |
| P1-9 删除撤销 | ✅ 本轮新增 | `files.js:509-588`：≤25MB 单文件删除前缓存 blob → 删除 → 5s 撤销 toast（`ui.js:60` toast 支持 duration）；撤销=PUT 回原 path+原 Content-Type；目录/大文件/批量保持确认弹窗 | PASS：删除出"撤销"且**无确认弹窗**；点撤销→行恢复+**内容字节级一致**。诚实边界：恢复对象的 uploaded 时间戳为恢复时间（R2 不存原始 mtime），名称/内容/类型不变 |
| P1-10 预览锁 460px | ✅ 已在 main（b32ef2d） | 无需改 | PASS：预览 maxWidth=720px |
| P1-11 网格卡修改时间 | ✅ 已在 main（b32ef2d） | 无需改 | PASS：grid-date 2/2 卡片 |
| P1-12 总览空白 | ✅ 已在 main（b32ef2d，非对称三级） | 无需改 | PASS：hero=1+band=1（非 2×2）；截图 tidy-overview.png。"最近上传"未加——无后端接口（不虚构数据），现布局已消除空白 |

### P2（细节）

| 条 | 状态 | 证据 |
|---|---|---|
| 动效分性格 | ✅ 已达标（无需改） | `--ease-smooth`（位移/遮罩/抽屉）+ `--ease-spring`（按压回弹）双曲线；出现 ease-out/退出 ease-in |
| 暗色字重/对比度 | ✅ 已达标 | `[data-theme=dark] --fw-body:350`；文字三级色暗色专用 |
| 间距收敛 | ✅ 已达标 | `--space-1..6` = 4/8/12/16/24/32；20px 为记录在案的批准例外 |
| 类型筛选计数 / 默认排序 | ⏸ 未做+纠正 | 类型计数=可选增强未做（如需再排期）；**任务书"排序目前是修改时间"与实际不符——当前默认排序是"按名称"**（SORT_DEFAULT_DIR name:1），保持不变 |

## 2. 回归

- 搜索/筛选/刷新/预览/网格切换：26/26 套件内覆盖 ✅
- Ctrl+A 批量条 + 清除选择：PASS（"已选 8 项"→隐藏）✅
- `npm run check`（9 文件）+ `npm test`（95 断言）：✅ 全绿
- 零应用控制台错误（pageerror/console.error 均无）

## 3. 待真机验证清单（桌面无法替代）

P0-5 键盘弹起后按钮可见可点、P0-6 反复开关键盘 5 次稳定性、P1-1 iOS 聚焦不缩放、P1-3 键盘键帽（下一步/前往）、P1-2 拇指点击。**本机无 Android SDK 模拟器**（D:\android-env 只有 adb，无 emulator/AVD），Playwright 移动模拟已覆盖布局逻辑。

## 4. 疑问清单（按指令第 6 节，不猜着改）

1. **P0-6 残影**：无法本地复现（无软键盘），已按预判先固定布局高度；真机复现后若仍残影再定位（可能方向：Bitwarden 浮层与键盘动画的合成层问题，属浏览器层）。
2. **P1-9 撤销的时间戳语义**：恢复对象 uploaded=恢复时刻。若需保留原时间需 Worker 侧支持自定义 mtime（改存储行为，超出本任务红线），默认不改。
3. **P1-12"最近上传"**：无后端接口支持；不做假数据。若您希望，后续可加 Worker 端 recent 列表（新端点=新授权）。
4. **P1-8 深度**：本轮按"尺寸+危险标题+遮罩亮度"区分三种弹窗，未引入插画级差异化（避免过度装饰）。

## 5. 部署同步（✅ 已解决，2026-11-14）

首轮定位"线上=82cff2b 时代、三个重构提交未部署"后，整理轮代码以 `183e49c` 推送，**Workers Builds 随之触发并成功部署**：线上 app.js/style.css 与 main（`183e49c`）hash 完全一致（之前 b32ef2d 无回写 + 线上旧版的现象为一次性的构建未执行，本次 push 已把积压版本一并带上）。Actions run 43538993068（test + verify-deployment）全绿。线上登录态功能按红线由用户浏览器自验（清单见 §3 + §1 各条验收）。

## 6. 改动文件清单（本轮）

- `public/panel/index.html`（viewport、enterkeyhint、field-error 槽、忘记密码行）
- `public/panel/style.css`（svh+top 锚定、16px、48px、44px、field-error、login-in、compact/danger、遮罩 0.45）
- `public/panel/app.js`（分字段校验、busy、Enter 跳转、focusin scrollIntoView）
- `public/panel/js/files.js`（clearSearch 重载、删除撤销）
- `public/panel/js/dialogs.js`（compact 参数与 confirmDialog 接线）
- `public/panel/js/ui.js`（toast duration）
- 新增本报告；截图 5 张（tidy-login-light / tidy-login-mobile-390 / tidy-undo-toast / tidy-confirm-danger / tidy-overview）

**提交需在您的终端或再次授权脚本通道执行**（Mimosa L3 全项目扫描拦截 ZCode 内 commit 的既有情况未变，误报证据链已归档）。
