# R2 WebDAV

> **把 Cloudflare R2 变成一个真正能用的私人云盘。**
>
> 网页管理文件、手机电脑访问、WebDAV、文件预览、临时分享，一个 Worker 搞定。

如果你已经有 Cloudflare R2，又觉得 R2 原生管理文件不方便，这个项目就是为你准备的。

## 你可以拿它做什么？

- 上传、下载、删除、移动、复制、重命名文件
- 手机和电脑都能用，界面会自动适配
- 搜索文件、排序、网格/列表查看
- 图片、视频、音频、PDF、文本直接预览
- 大文件自动使用 R2 Multipart 上传
- 支持批量删除、复制、移动
- 给文件生成临时分享链接
- 分享链接可以设置有效期
- 支持 WebDAV，可接 OpenList 等客户端
- 支持浅色、深色和跟随系统
- 文件直接存放在你自己的 R2 Bucket

## 没有电脑，也可以部署

**不需要 VPS，也不需要一直开着电脑。**项目部署完成后运行在 Cloudflare 上。

第一次部署需要创建 R2、设置账号密码并部署 Worker。**只有手机也能完成**，Android 可以直接用 Termux；iPhone/Android 也可以通过手机浏览器操作 GitHub 和 Cloudflare。

> 目前项目没有提供“一键网页安装器”，所以纯手机部署会比电脑麻烦一些。后续如果增加一键安装方式，会在这里单独说明。

### 你需要准备

1. 一个 Cloudflare 账号
2. 一个 Cloudflare R2 Bucket
3. GitHub 仓库
4. 一个 WebDAV 用户名和密码

不需要 VPS、Docker、独立服务器、数据库，也不需要电脑一直开机。

## 快速部署

### 有电脑

```bash
git clone https://github.com/2186748980/R2-WebDAV.git
cd R2-WebDAV
npm install
npx wrangler login
```

### 只有 Android 手机

在 Termux 中：

```bash
pkg update
pkg install git nodejs
git clone https://github.com/2186748980/R2-WebDAV.git
cd R2-WebDAV
npm install
npx wrangler login
```

Wrangler 会给出 Cloudflare 授权地址，用手机浏览器打开即可完成登录。

### 创建 R2 Bucket

在 Cloudflare 控制台创建一个 R2 Bucket，然后把名称填入 `wrangler.toml`：

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "你的 Bucket 名称"
```

### 设置账号密码

**不要把密码写进 `wrangler.toml`。**

```bash
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
```

### 部署

```bash
npm run deploy
```

项目会自动检查 Secret、部署 Worker，并验证生产环境。缺少必要 Secret 时会直接停止部署。

## 部署完成后怎么用？

假设 Worker 地址是 `https://your-worker.workers.dev`。

### 网页管理

打开 `https://your-worker.workers.dev/panel/`，登录后就可以像普通网盘一样管理文件。

### WebDAV

直接使用 Worker 地址作为 WebDAV 地址：

| 项目 | 内容 |
|---|---|
| 地址 | Worker 地址 |
| 用户名 | 你设置的 WebDAV 用户名 |
| 密码 | 你设置的 WebDAV 密码 |

一般不需要额外加 `/webdav` 或 `/dav`。

### OpenList

在 OpenList 中添加 WebDAV 存储：

- 地址：Worker 地址
- 用户名：WebDAV 用户名
- 密码：WebDAV 密码
- TLS：开启

## 文件分享

选择文件即可生成临时分享链接。

- 只对应被分享的文件
- 不会暴露整个文件列表
- 不需要登录 WebDAV
- 支持有效期
- 使用签名保护链接

目前支持 1 小时、24 小时、7 天。

它更适合“我有一个文件，想临时发给别人”，而不是公开网盘或大型文件分享站。

## 大文件

管理面板会根据文件大小自动选择普通上传或 R2 Multipart Upload。

当前 **20 MiB 及以上**的文件会使用 Multipart。刷新或关闭页面后，正在进行的 Multipart 上传不会自动恢复。

## 安全

这是一个**单用户私人云盘**：

- WebDAV 使用 Basic Auth
- 管理面板登录后使用 HttpOnly Session
- WebDAV 用户名和密码使用 Cloudflare Secret
- 前端不会从服务器读取保存的密码
- 分享链接使用签名和有效期
- 不提供匿名目录浏览
- 没有多用户 / RBAC
- 删除文件后不会进入回收站

不要把 WebDAV 密码、Cloudflare API Token、R2 S3 密钥提交到 GitHub。

## 适合谁？

**很适合：**个人云盘、OpenList、WebDAV、文件临时分享、已经使用 Cloudflare R2 的用户。

**不太适合：**企业多人协作、大规模公共下载站、海量视频存储、唯一灾备方案。

Cloudflare 的免费额度和限制会变化，实际费用取决于使用量。重要文件请保留独立备份。

## 项目怎么工作？

```text
手机 / 电脑 / OpenList
          │
     HTTPS / WebDAV
          ↓
   Cloudflare Worker
   网页 + API + 认证
          │
          ↓
   Cloudflare R2
      你的文件
```

R2 负责保存文件，Worker 负责网页、WebDAV、认证和文件操作。

## 自动部署

连接 Cloudflare Workers Builds 后：

```text
push GitHub
    ├── GitHub Actions → 测试 / 验证
    └── Cloudflare Workers Builds → 生产部署
```

GitHub Actions 负责检查代码，Cloudflare Workers Builds 负责实际生产部署。

## 开发者

```bash
npm install
npm run check
npm test
```

项目主要由 Cloudflare Workers、Cloudflare R2、WebDAV 和原生 HTML / CSS / JavaScript 组成，不需要前端构建框架。

```text
R2-WebDAV/
├── src/worker.js
├── public/panel/
├── scripts/
├── test/
├── wrangler.toml
└── package.json
```

## 相关文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

---

**R2 WebDAV**

让你的 Cloudflare R2，不只是一个存储桶，而是一个真正可以使用的私人云盘。