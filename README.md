# R2 WebDAV

把 **Cloudflare R2 变成一个可通过 WebDAV 访问的私人云盘**。

项目运行在 **Cloudflare Workers** 上，文件存储在你自己的 **Cloudflare R2 Bucket** 中。除了标准 WebDAV 接口，还提供现代化的 Web 管理面板，用于文件浏览、上传、预览、批量操作和临时分享。

> 适合个人文件、配置文件、照片、备份和轻量级文件存储。
>
> 项目不需要 VPS、Docker 或独立服务器；WebDAV 凭据使用 Cloudflare Worker Secrets 保存。

## 特性

### WebDAV

| 功能 | 状态 |
|---|---|
| HTTPS | ✅ |
| Basic Auth | ✅ |
| 上传 / 下载 | ✅ |
| 目录浏览 | ✅ |
| 新建目录 | ✅ |
| 删除 | ✅ |
| 复制 / 移动 | ✅ |
| Range 下载 | ✅ |
| ETag / Last-Modified | ✅ |
| OpenList | ✅ |
| LOCK / UNLOCK | ❌ |

支持 OPTIONS、PROPFIND、GET、HEAD、PUT、DELETE、MKCOL、COPY、MOVE 等常用 WebDAV 方法。

### Web 管理面板

访问：

- 面板：/panel/
- WebDAV：/

主要功能：

- 登录认证与 24 小时 HttpOnly Session
- 文件列表 / 网格视图
- 排序、搜索、面包屑和加载更多
- 拖拽上传、文件选择、上传进度、暂停 / 继续 / 取消 / 重试
- ≥20 MiB 自动使用 R2 Multipart Upload
- 新建目录、重命名、复制、移动、删除
- 批量删除 / 复制 / 移动
- 图片、视频、音频、PDF、文本预览
- 临时分享链接
- 分享有效期：1 小时 / 24 小时 / 7 天
- 浅色 / 深色 / 跟随系统主题
- 移动端抽屉导航和底部操作面板
- 文件详情与高级信息
- WebDAV 连接配置说明
- R2 状态和基础存储信息

面板同时适配桌面端和移动端。

## 工作原理

```text
┌──────────────────────────────┐
│       手机 / 电脑 / OpenList  │
└──────────────┬───────────────┘
               │ HTTPS / WebDAV
               ▼
┌──────────────────────────────┐
│      Cloudflare Worker       │
│                              │
│  WebDAV API + 管理面板 + Auth │
└──────────────┬───────────────┘
               │ R2 Binding
               ▼
┌──────────────────────────────┐
│      Cloudflare R2 Bucket    │
│          文件对象存储         │
└──────────────────────────────┘
```

R2 本身是对象存储，没有传统文件系统中的真实目录。

例如：

```text
backups/mihomo/config.yaml
```

实际上是一个带前缀的 R2 Object。Worker 将这些 Object 映射成 WebDAV 客户端看到的文件和目录。

## 快速部署

### 环境要求

- Cloudflare 账号
- Node.js + npm
- Wrangler
- 一个 Cloudflare R2 Bucket

不需要 VPS、Docker 或 Linux 服务器。

### 1. 克隆项目

```bash
git clone https://github.com/2186748980/R2-WebDAV.git
cd R2-WebDAV
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 R2 Bucket

修改 wrangler.toml：

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "your-webdav-bucket"
```

然后创建同名 Bucket：

```bash
npx wrangler r2 bucket create your-webdav-bucket
```

### 4. 设置 WebDAV 凭据

**必须使用 Worker Secret，不要配置成普通 Text/明文变量。**

```bash
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
```

项目不会把凭据写入 wrangler.toml。

### 5. 部署

```bash
npm run deploy
```

部署脚本会依次执行：

```text
predeploy
  ↓
check-secrets.mjs
  ↓
wrangler deploy
  ↓
verify-deployment.mjs
```

缺少 WEBDAV_USERNAME 或 WEBDAV_PASSWORD 时会直接终止部署，避免产生未配置凭据的生产版本。

## 使用 WebDAV

部署完成后，使用 Worker HTTPS 地址作为 WebDAV 服务器。

| 配置 | 内容 |
|---|---|
| 服务器地址 | Worker HTTPS 地址 |
| 用户名 | WEBDAV_USERNAME |
| 密码 | WEBDAV_PASSWORD |
| 根路径 | / |

一般**不要**额外添加 /webdav、/dav 等路径。

### OpenList

新增存储 → 选择 **WebDAV**：

- 地址：Worker HTTPS 地址
- 用户名：WebDAV 用户名
- 密码：WebDAV 密码
- TLS 证书验证：开启

## 临时分享

管理面板可以为单个文件生成临时分享链接。

分享链接：

- 只允许访问被分享的单个文件
- 不提供目录列表
- 不允许 WebDAV 操作
- 不需要 Basic Auth
- 使用 HMAC-SHA-256 签名
- 有效期最长 7 天
- 修改 WEBDAV_PASSWORD 后，原分享链接立即失效

当前分享有效期选项：

```text
1 小时
24 小时
7 天
```

> 当前分享系统定位为轻量临时分享，不是公开文件市场或多用户协作系统。

## 大文件

管理面板对 **≥20 MiB** 的文件自动使用 R2 Multipart Upload。

R2 Multipart 支持：

- 最大对象：5 TiB
- 最多：10,000 个 Part
- 非最后 Part：至少 5 MiB

浏览器端只在当前页面保存 Multipart 状态。刷新或关闭页面后不会自动恢复中断上传。

实际可用上传能力仍受 Cloudflare Workers、R2 和浏览器环境限制，请以当前 Cloudflare 官方限制为准。

## 安全设计

### 凭据

以下内容**不要提交到 GitHub**：

- WEBDAV_USERNAME
- WEBDAV_PASSWORD
- Cloudflare API Token
- R2 S3 Access Key
- R2 S3 Secret Key

WebDAV 用户名和密码使用 Worker Secrets。

### 管理面板

/panel 的静态页面可以公开加载，但实际数据接口始终需要认证。

登录后：

```text
Basic Auth
    ↓
HMAC 签名 HttpOnly Cookie
    ↓
24 小时 Session
```

前端不会从服务器读取 WebDAV 密码，也不会将密码写入 URL、localStorage 或 sessionStorage。

修改 WEBDAV_PASSWORD 会使已有 Session 和临时分享链接失效。

### 单用户模型

当前项目是**单用户私人云盘**：

- 一个 WebDAV 账号
- 无 RBAC
- 无多用户数据库
- 无匿名目录访问
- 删除立即生效
- 无回收站

如果需要灾难恢复，请使用独立 R2 备份、版本控制或生命周期策略，不要把本项目作为唯一数据副本。

## 本地检查

不需要真实 R2 数据即可运行项目测试：

```bash
npm run check
npm test
```

部署前 Secret 检查：

```bash
node scripts/check-secrets.mjs
```

部署后生产验证：

```bash
node scripts/verify-deployment.mjs https://your-worker.workers.dev --wait 300
```

测试覆盖包括：

- Panel 路由与认证
- Panel API
- WebDAV 方法
- Multipart
- Range
- ETag
- 分享签名与过期
- 中文、空格、% 文件名
- 路径穿越防护
- 文件上传 / 下载等核心逻辑

## 自动部署

生产环境使用 **Cloudflare Workers Builds + GitHub**。

```text
git push main
      │
      ├──────────────► GitHub Actions
      │                 ├─ npm test
      │                 └─ npm run check / production verify
      │
      └──────────────► Cloudflare Workers Builds
                         │
                         └─ npm run deploy
                              ├─ Secret 检查
                              ├─ Wrangler 部署
                              └─ 生产验证
```

GitHub Actions 负责独立测试和验收；Cloudflare Workers Builds 负责生产部署。

生产部署必须经过：

```text
check-secrets
    ↓
wrangler deploy
    ↓
verify-deployment
```

项目不会通过 GitHub Actions 绕过 Cloudflare 的生产部署链路。

## 自定义域名

如果 Cloudflare 托管你的域名，可以给 Worker 配置 Custom Domain，例如：

```text
https://dav.example.com
```

然后直接使用该地址作为 WebDAV 服务器。

## 项目结构

```text
R2-WebDAV/
├── src/
│   └── worker.js              # WebDAV + API + 认证核心
├── public/
│   └── panel/                 # Web 管理面板
│       ├── app.js
│       ├── style.css
│       └── js/
├── scripts/
│   ├── check-secrets.mjs      # 部署前 Secret 门禁
│   └── verify-deployment.mjs  # 部署后生产验证
├── test/
│   └── worker.test.mjs        # 核心测试
├── wrangler.toml
└── package.json
```

## 使用边界

这个项目适合：

- 个人文件
- 手机 / 电脑文件访问
- 配置文件和备份
- OpenList 等 WebDAV 客户端
- 轻量级文件分享

不建议直接当作：

- 大规模视频站
- 企业级多人网盘
- 唯一的灾备系统
- 高并发公共下载站

实际成本取决于 Cloudflare 当前 Workers / R2 用量和计费规则。部署前请以 Cloudflare 官方文档和你的实际用量为准。

## 路线

项目目前优先保持：

```text
WebDAV
  +
R2 文件管理
  +
移动端 Panel
  +
临时分享
  +
安全部署
```

后续可以继续增强分享管理、下载统计等能力，但不会为了堆功能而引入不必要的数据库或基础设施。

## 相关文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

---

**R2 WebDAV = Cloudflare Workers + Cloudflare R2 + WebDAV。**

一个 Worker，一个 R2 Bucket，一个 HTTPS 地址，把你的 R2 变成自己的 WebDAV 私人云盘。
