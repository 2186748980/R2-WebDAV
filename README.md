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

### 5. 部署

```bash
npx wrangler deploy
```

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

测试覆盖 OPTIONS、Basic Auth、MKCOL、PUT/覆盖上传、PROPFIND、GET、HEAD、COPY、MOVE 和 DELETE。

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