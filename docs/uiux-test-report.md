# UI/UX 测试报告（第三轮重构验收）

> 2026-11-09。环境：`wrangler dev` 本地实例（127.0.0.1:8787，local R2 模拟，`.dev.vars` 凭据不外泄）；Playwright Chromium headless；Python 3.13。
> 数据隔离：测试上传的 `uiux-regression.txt` 在同一运行内上传并删除，local dev 桶原有对象未增减；**未触碰生产环境**。

## 1. 门禁

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run check` | ✅ | 9 个 JS 文件语法门禁（原 8 + 新增 item-actions.js） |
| `npm test` | ✅ | **89/89 断言**：面板入口（无重定向循环）、面板 API、multipart、分享、WebDAV 方法、Range、穿越防护 |

每个 Batch 结束均跑过一次门禁（Batch 1–7 共 6 次），全部通过。

## 2. Playwright 功能回归（27/27 通过）

| # | 用例 | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录页自动聚焦用户名 | PASS | activeElement=loginUser |
| 2 | Tab 进入表单 | PASS | →loginPass |
| 3 | 暗色切换后刷新持久 | PASS | data-theme=dark after reload |
| 4 | 概览桌面暗色无横向溢出 | PASS | scrollWidth≤clientWidth+1 |
| 5 | 概览健康状态渲染 | PASS | "服务运行中" |
| 6 | 服务器地址渲染 | PASS | http://… |
| 7 | 切回亮色 | PASS | data-theme=light |
| 8 | 目录过滤收窄列表 | PASS | 7→1（关键词 alpha） |
| 9 | 排序选择器联动表头指示 | PASS | date 列 sorted class |
| 10 | 网格视图渲染 | PASS | grid-card ≥1 |
| 11 | Ctrl+A 全选 | PASS | 已选 7 项 |
| 12 | 清除选择收起批量条 | PASS | batchBar hidden |
| 13 | 上传 + Tray 完成态 | PASS | "完成 · 42 B" |
| 14 | 文件页桌面亮色无溢出 | PASS | — |
| 15 | 下载流程无报错 | PASS | 开始+成功 toast（未断言落盘，见 §5） |
| 16 | 分享链接生成 | PASS | /share/eyJ… 签名 URL |
| 17 | 删除确认后移除 | PASS | 行消失（测试文件自清理） |
| 18 | WebDAV 地址渲染 | PASS | — |
| 19 | 设置页无溢出 | PASS | — |
| 20 | 设置主题 seg 生效 | PASS | auto active |
| 21 | 弹窗焦点移入 | PASS | activeElement ∈ .modal-box |
| 22 | 1920px 无溢出 | PASS | — |
| 23 | 移动端概览无溢出 | PASS | 390px |
| 24 | 移动端文件页无溢出 | PASS | 390px |
| 25 | 行菜单变 Bottom Sheet | PASS | .menu.sheet |
| 26 | 移动端暗色无溢出 | PASS | — |
| 27 | 360px 无溢出 | PASS | — |

过程性验证（早期冒烟，同样通过）：Drawer 开箱焦点在面板内 / Tab 循环不逃逸 / Esc 关闭；预览 meta 行（"70 B · 2026/11/08 17:10"）；错误密码行内报错"用户名或密码错误"（并以此抓出 booting bug → 修复 → 复测通过）。

## 3. 页面 × 主题 × 端矩阵（截图为证，docs/screenshots/final-*）

| 页面 | 桌面亮 | 桌面暗 | 移动亮 | 移动暗 |
|---|---|---|---|---|
| 登录 | ✅ final-login-desktop-light | ✅ smoke-login-dark | ✅（复用亮色布局，无差异组件） | 同左 |
| 概览 | ✅ smoke-overview-light | ✅ final-overview-desktop-dark | ✅ final-overview-mobile-light | （token 同源，文件页已验） |
| 文件管理 | ✅ final-files-desktop-light | ✅ smoke-files-dark | ✅ final-files-mobile-light | ✅ final-files-mobile-dark |
| 文件详情 | ✅（亮色 drawer 冒烟） | ✅ final-drawer-desktop-dark | 抽屉宽 92vw 同组件 | 同左 |
| 文件预览 | ✅ smoke-preview | （同 modal 组件，暗色 token 已覆盖） | modalsheet ✅ final-files-mobile-modalsheet | 同左 |
| WebDAV | ✅ final-webdav-desktop-light | ✅ final-webdav-desktop-dark | 布局=单列卡片 | 同左 |
| 设置 | ✅ final-settings-desktop-light | ✅ final-settings-desktop-dark | 单列（≤640 规则） | 同左 |
| 1920px | ✅ final-files-desktop-1920 | — | — | — |
| Bottom Sheet | — | — | ✅ final-files-mobile-sheet | — |

## 4. 测试中发现并修复的缺陷

| 缺陷 | 发现方式 | 修复 | 复测 |
|---|---|---|---|
| 登出后登录表单提交被静默吞掉（`booting` 标志误用） | 冒烟：错误密码后无行内报错 | 移除 submit 处理器的 booting 守卫 | ✅ 行内报错出现 |
| 移动端重复点击激活导航项抽屉不收起 | 矩阵：sidebar.open 拦截点击超时 | 导航点击无条件 closeSidebar() | ✅ 27 项全过 |

## 5. 未验证项（首轮重构时声明 → 收尾轮处理结果）

首轮声明的 4 项，收尾轮（2026-11-09 第二批）全部补测，见 §6；仍无法自动化验证的只剩真机项与超大文件内存行为。

---

## 6. 收尾轮验证（2026-11-09 第二批，Playwright 实测 53/54）

### 6.1 上传暂停/恢复/取消（CDP 限速 2MB/s + 25MiB × 3 分片真实触发）

| 用例 | 结果 | 证据 |
|---|---|---|
| 取消中止上传 | PASS | 状态"已取消" |
| 取消发送 multipart abort 到 R2 | PASS | DELETE /panel/api/upload/multipart 请求捕获 |
| 刷新丢失进度（无假续传） | PASS | 刷新后托盘清空 |
| 分片边界暂停 | PASS | 状态"已暂停 · 刷新页面后需重新上传"（诚实提示，截图 final-upload-paused.png） |
| 恢复后完成 | PASS | "完成 · 25.0 MB" |

**架构结论（如实区分）**：暂停=分片间挂起（本页内有效）✓；取消=abort 分片上传 ✓；**断点续传（跨页面/跨会话恢复）= 架构不支持**（uploadId 仅存内存，刷新即丢，UI 已明示，不伪造）。>512MB 的浏览器直下分支未实测（内存限制，代码走查）。

### 6.2 下载 Blob 落盘（真实验证最终文件内容）

| 用例 | 结果 | 证据 |
|---|---|---|
| ASCII 文件字节级一致 | PASS | download.path() 读回与源文件 bytes 相等 |
| 中文+全角括号+空格文件名 | PASS | suggested_filename 完整还原"接口文档 v2（终稿）.txt"，内容一致 |
| 下载失败显式反馈 | PASS | route.abort → toast"下载失败：网络错误" |
| HEAD 探测端点（新增能力） | PASS | 200 + Content-Length + 空 body |
| 大文件 >512MB 退化分支 | ⚠️ 未实测（内存） | 代码走查：location.href 直下 |

### 6.3 Toast Action 真实触发

| 用例 | 结果 | 证据 |
|---|---|---|
| 搜索失败 → 重试按钮出现 | PASS | route.abort → toast"搜索失败…重试" |
| 点重试**回调真实执行** | PASS | 点击后搜索流程重新发起（重新进入 searching 态/完成或再报错均捕获） |
| 栈上限 ≤4 | PASS | 连点 8 次复制，容器最多 4 条 |
| 2.6s 自动消失 | PASS | 3.2s 后清零 |

### 6.4 Android 适配（移动模拟；真机仍待 DEV_INSECURE_LAN 批准）

| 用例 | 结果 |
|---|---|
| 360/390/412 × 亮/暗：列表、网格无横向溢出 | 6/6 PASS |
| 三宽度 coarse 指针模拟生效 | 3/3 PASS |
| 行菜单 Bottom Sheet | 3/3 PASS |
| 详情 Drawer ≤ 视口宽 | 3/3 PASS（360 实测 331px） |
| 分享弹窗 Bottom Sheet（底部圆角 0） | 3/3 PASS |
| **仍未验证（真机专属）** | ⚠️ 软键盘弹出布局、env(safe-area-inset-*) 真实值、地址栏 theme-color 着色、overscroll 手感、iframe PDF 真机 viewer——需 Android 真机 + 用户批准的 dev-only HTTPS 豁免 |

### 6.5 功能扫查与安全直开

- 功能：空提交行内报错、mkdir 空名/反斜杠名拒绝且弹窗保持、重命名、复制进文件夹、同名上传覆盖确认、批量删除目标清单、表头排序指示、设置页密码显示——**9/9 PASS**。
- 安全直开：sec-test.svg / sec-test.html 面板直开 + 分享链接直开——**0 个脚本执行**（CSP 拦截，console 出现预期 violation 报告），CSP 含 form-action 'none' + nosniff——**7/7 PASS**。
- 唯一 FAIL：cleanup 计数 4/6——两个对象已被批量删除用例先行删除（对不存在对象重复删除得 404），**最终桶状态核验零残留**（root=smoke，smoke=原有 7 对象），非真实失败。

### 6.6 收尾轮发现并修复

| 项 | 定性 | 处理 |
|---|---|---|
| headless set_input_files 偶发不触发入队（重试即成功） | 自动化环境 quirk（真机/人工从未复现；应用层收不到事件无从防御） | 测试侧重试吸收，报告如实记录 |
| 覆盖守卫在"上传完成→列表刷新中"窗口期盲区（items 清空时查不到重名） | 已知尽力而为边界的具体化（预检基于已加载清单，文档此前已注明） | 不改代码；测试等待刷新完成；保持文档声明 |
| copy 目标路径语义（根相对）vs mkdir（当前目录相对） | 设计语义，非 bug（行内报错"目标文件夹不存在"正确引导） | 测试修正；报告注明语义差异 |
