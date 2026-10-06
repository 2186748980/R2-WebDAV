# R2 WebDAV

把 **Cloudflare R2 变成一个可以通过 WebDAV 访问的私人网盘**。

这个项目运行在 **Cloudflare Workers** 上，文件实际存放在你自己的 **Cloudflare R2 Bucket** 中。手机、电脑、OpenList 或其他支持 WebDAV 的软件，都可以通过一个 HTTPS 地址访问这些文件。

> 适合个人文件、配置文件、备份、照片/视频等轻量场景。
> 本项目不会把你的 Cloudflare 账号、R2 密钥或 WebDAV 密码写进代码。

## 它是怎么工作的？

```text
手机 / 电脑 / OpenList
        │
        │ WebDAV + HTTPS
        ▼
Cloudflare Worker
        │
        │ R2 Binding
        ▼
你的 Cloudflare R2 Bucket
        │
        ▼
你的文件
```

你不需要购买 VPS，也不需要自己维护服务器。

Worker 负责：
- WebDAV 协议
- HTTPS
- 用户名/密码认证
- 文件上传、下载、删除
- 文件夹创建和浏览
- 文件复制、移动
- R2 与 WebDAV 之间的数据转换

R2 负责真正保存文件。

## 支持什么？

| 功能 | 支持情况 |
|---|---|
| HTTPS | ✅ |
| Basic Auth 用户名/密码 | ✅ |
| 上传文件 PUT | ✅ |
| 下载文件 GET | ✅ |
| 查看目录 PROPFIND | ✅ Depth 0 / 1 |
| 创建文件夹 MKCOL | ✅ |
| 删除文件/文件夹 DELETE | ✅ |
| 复制 COPY | ✅ |
| 移动 MOVE | ✅ |
| Range 下载 | ✅ |
| ETag / Last-Modified | ✅ |
| OpenList | ✅ |
| Mihomo / Clash / sing-box 配置备份 | ✅ |
| 多用户权限管理 | ❌ |
| 匿名访问 | ❌ |
| LOCK / UNLOCK | ❌ |

## 部署前需要什么？

只需要：
1. 一个 Cloudflare 账号
2. 一个 R2 Bucket
3. 一个 Cloudflare Worker
4. 一个 WebDAV 用户名和密码
5. 一个支持 WebDAV 的客户端

不需要 VPS、Docker、Linux 服务器或 R2 S3 API Token。

## 快速部署

### 1. 下载项目

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

先在 `wrangler.toml` 中把 `bucket_name` 改成你自己的 Bucket 名称，然后创建同名 Bucket：

```bash
npx wrangler r2 bucket create your-webdav-bucket
```

### 4. 设置 WebDAV 账号密码

不要把账号密码写进代码。

```bash
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
```

> **必须使用 "Secret" 类型，不要用 "Text"。**
> 如果在 Dashboard 的 *Variables and Secrets* 里把这两个值添加成 **Text（明文变量）**，下一次 `wrangler deploy`（包括 Git 自动部署）会把它们清掉，整个服务会变成 503 "WebDAV service is not configured."。Secret 类型会被后续每次部署自动继承，且永远不需要写进 `wrangler.toml`。

### 5. 部署

```bash
npm run deploy
```

`npm run deploy` = 部署前检查（`scripts/check-secrets.mjs`，缺少任一 Secret 直接终止部署并给出修复指引）→ `npx wrangler deploy` → 部署后验证（`scripts/verify-deployment.mjs`，确认线上认证门生效、`/panel` 无重定向）。

部署成功后，Wrangler 会给你一个类似这样的地址：

```text
https://your-webdav-worker.your-subdomain.workers.dev/
```

这个地址就是你的 WebDAV 地址。

## 在 OpenList 中使用

在 OpenList 中新增存储，选择 **WebDAV**。

| 项目 | 填写内容 |
|---|---|
| 地址 | 你的 Worker HTTPS 地址 |
| 用户名 | `WEBDAV_USERNAME` 的实际值 |
| 密码 | `WEBDAV_PASSWORD` 的实际值 |
| 根路径 | `/` 或 `/backups` |
| TLS 证书验证 | 开启 |

注意：地址一般不要再额外添加 `/webdav`、`/dav` 等路径。

## 手机 / 电脑客户端

只要软件支持 WebDAV，就可以连接。

填写：

```text
服务器地址：你的 Worker 地址
用户名：你的 WebDAV 用户名
密码：你的 WebDAV 密码
```

## 配置文件备份

这个项目特别适合保存小型配置文件，例如：

```text
/backups/
├── mihomo/
│   ├── config.yaml
│   └── providers.yaml
├── sing-box/
│   └── config.json
└── other/
    └── backup.txt
```

## 本地测试

不需要 Cloudflare 账号即可运行模拟 R2 测试：

```bash
npm run check
npm test
```

部署链路上的两个检查脚本也可以单独运行（需要能访问 Cloudflare API / workers.dev 的网络）：

```bash
node scripts/check-secrets.mjs                                  # 检查两个 Secret 是否以 Secret 类型存在
node scripts/verify-deployment.mjs https://r2-webdav.2186.workers.dev --wait 300   # 部署后验证线上
```

GitHub Actions 在每次 push 后也会自动运行同样的线上验证（`verify-deployment` job）：线上出现 503 未配置、认证门失效或 `/panel` 重定向时，该 job 会明确失败。

测试覆盖：管理面板三个入口（`/panel`、`/panel/`、`/panel/index.html`，认证后必须 200 且无重定向）、面板全部 API（config/list/file/download/upload/multipart/action/stats/health/search/share）、WebDAV 全方法（OPTIONS、PROPFIND、GET、HEAD、PUT、DELETE、MKCOL、COPY、MOVE）、Range 请求、ETag 条件请求、中文/空格/% 文件名、路径穿越防护、分享链接签名与过期。

## 安全注意事项

不要把 `WEBDAV_USERNAME`、`WEBDAV_PASSWORD`、Cloudflare API Token、R2 S3 Access Key 或 R2 S3 Secret Key 提交到 GitHub。

项目使用 Worker Secrets 保存 WebDAV 账号密码。

也不要关闭认证，否则任何知道 Worker 地址的人都有可能访问你的文件。

## R2 和 WebDAV 的关系

R2 本质上是对象存储，并没有传统服务器那种真正的文件夹。

例如：

```text
backups/mihomo/config.yaml
```

本质上是一个 R2 对象。Worker 会把这些对象转换成 WebDAV 客户端看到的文件和目录。

## 使用边界

这个项目更适合个人使用和轻量文件存储。如果大量上传视频、频繁同步或进行大规模目录扫描，需要根据 Cloudflare 当前的 Workers / R2 额度和计费规则评估成本。

## 项目结构

```text
R2-WebDAV/
├── src/
│   └── worker.js          # WebDAV 核心代码
├── test/
│   └── worker.test.mjs    # 本地模拟 R2 测试
├── wrangler.toml          # Worker + R2 配置
├── package.json
└── README.md
```

## 自定义域名

默认可以使用 `workers.dev` 地址。如果你有 Cloudflare 托管的域名，也可以给 Worker 配置 Custom Domain，例如 `https://dav.example.com`。

## 一句话总结

**R2 WebDAV = Cloudflare Worker + Cloudflare R2 + WebDAV。**

Worker 负责提供 WebDAV 接口，R2 负责存文件。你只需要一个 HTTPS 地址，就可以从手机、电脑和 OpenList 访问自己的文件。

## 相关文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## Management panel

After deployment, open:

- Management panel: `https://r2-webdav.2186.workers.dev/panel/`
- WebDAV endpoint: `https://r2-webdav.2186.workers.dev/`

The panel is protected by the same `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` Basic Auth credentials. It provides:

- Dashboard and server connection information
- R2 file/folder browsing with pagination
- Folder creation
- Multi-file upload with progress
- Small files stream directly; large files automatically use R2 Multipart
- Pause / continue / cancel / automatic retry for uploads
- Download and in-browser preview for common image/video/audio/PDF/text formats
- Rename, copy, move and batch delete/copy/move
- Current-directory filtering plus recursive search
- List/grid view and name/time/size sorting
- Storage statistics and R2 health check
- Temporary single-file share links (1 hour / 24 hours / 7 days)
- WebDAV/OpenList connection configuration
- Responsive mobile layout

The panel never returns the WebDAV password through its API. Keep `WEBDAV_PASSWORD` in Cloudflare Worker Secrets.

### Large files

The management panel automatically switches to R2 Multipart for files at or above 20 MiB. R2 multipart supports objects up to 5 TiB and up to 10,000 parts; each non-final part must be at least 5 MiB. The browser keeps the multipart upload state locally for the active page, so an interrupted browser session is not automatically resumed after a refresh.

### Temporary sharing

The file context menu can generate a read-only temporary URL. The URL is stateless and signed with HMAC-SHA-256 using the current `WEBDAV_PASSWORD` as the signing secret. Expiration is limited to 7 days. Changing `WEBDAV_PASSWORD` invalidates previously generated share URLs.

Share URLs bypass Basic Auth by design, but they only expose the single file represented by the signed token. They do not expose directory listing, WebDAV operations, or the management panel.

### Current design boundaries

This project intentionally remains a single-user private cloud:
- one Basic Auth account
- no RBAC / multi-user database
- delete is immediate; there is no recycle bin
- browser multipart uploads are resumable only while the current page retains their upload state
- WebDAV `LOCK` / `UNLOCK` are still not implemented

For stronger disaster recovery, keep an independent R2 backup or lifecycle/versioning strategy rather than treating this Worker as the only copy.

### Cloudflare Static Assets

The Worker serves `public/panel/` as Workers Static Assets while `run_worker_first` protects the panel and panel API with the existing Basic Auth. The WebDAV root path remains `/` for compatibility with existing clients.

## 部署架构（唯一生产部署链路）

```text
git push main
  → Cloudflare Workers Builds（GitHub 集成，script_tag 8cabe4d7…）
  → 构建容器执行 npm run deploy：
      1. predeploy: scripts/check-secrets.mjs   ← 缺 Secret 直接终止，不产生新版本
      2. npx wrangler deploy
      3. scripts/verify-deployment.mjs          ← 线上 401/503/重定向验证，失败即构建失败
  → GitHub Actions verify-deployment job 独立复查线上（5 分钟轮询）
```

生产部署命令配置在 Cloudflare Workers Builds 中为 `npm run deploy`（2026-10-06 由裸 `npx wrangler deploy` 收紧，裸命令曾导致无门禁的自动部署）；PR 预览构建已关闭。手动部署走同一条管线：`npm run deploy`。
