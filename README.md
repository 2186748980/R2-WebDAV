# Cloudflare R2 WebDAV Backup

一个面向 **Android VPN/代理配置备份** 的单用户 WebDAV 服务。它使用 Cloudflare R2 作为私有对象存储，并由 Cloudflare Worker 提供 HTTPS + HTTP Basic Authentication 的 WebDAV 接口。项目的目标是让 Mihomo、Clash、sing-box、OpenList 与常见 WebDAV 客户端可靠地创建目录、上传和覆盖配置、列出目录、下载、复制、移动及删除旧备份。

> 此仓库不包含任何 Cloudflare 账号、域名、Bucket、Worker 地址、用户名、密码、API Token 或其他部署凭据。部署前请将 `wrangler.toml` 中的示例值替换为自己的资源名称。

## 支持范围

| 功能 | 行为 |
|---|---|
| 认证 | 所有方法均需要 Basic Auth；认证失败返回 `401` 和 `WWW-Authenticate` |
| 传输安全 | Worker 通过 HTTPS 地址访问；代码对非 HTTPS 请求执行重定向 |
| 存储 | 私有 R2 Standard Bucket，经 `R2_BUCKET` Binding 访问 |
| WebDAV 方法 | `OPTIONS`、`PROPFIND`、`GET`、`HEAD`、`PUT`、`DELETE`、`MKCOL`、`COPY`、`MOVE` |
| 目录结构 | 使用 `目录名/` 零字节对象作为目录标记，并识别现有对象前缀为隐式目录 |
| `PROPFIND` | 返回 `DAV:` 命名空间的 `207 Multi-Status` XML，支持 `Depth: 0` 与 `Depth: 1` |
| 下载 | 支持 `Range`、`ETag`、`Last-Modified` 和内容类型元数据 |
| 非目标功能 | 不实现匿名访问、多人 ACL、LOCK/UNLOCK、版本历史或无限深度 `PROPFIND` |

该实现适用于小型配置文件备份，而不是大型网盘。Cloudflare Free 站点的请求体上限为 **100 MB**。[1]

## 项目结构

```text
.
├── src/worker.js            # WebDAV Worker 实现
├── test/worker.test.mjs     # 内存 R2 模拟集成测试
├── wrangler.toml            # Worker 与 R2 Binding 示例配置
├── package.json             # 检查、测试和部署脚本
└── README.md                # 本说明
```

## 部署

首先确保已安装 Node.js，并使用 `wrangler login` 登录自己的 Cloudflare 账号。复制后请修改 [`wrangler.toml`](./wrangler.toml) 中的两个占位符：`your-webdav-worker` 与 `your-webdav-bucket`。Bucket 名称只能使用小写字母、数字和连字符。

```bash
npm install
npx wrangler login

# 创建与 wrangler.toml 中 bucket_name 完全相同的 R2 Standard Bucket。
npx wrangler r2 bucket create your-webdav-bucket

# 交互式设置认证凭据；不要把实际值写入文件或 Git。
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD

# 部署 Worker。
npx wrangler deploy
```

默认配置中 `workers_dev = true`，部署成功后 Wrangler 会显示类似以下的免费 HTTPS 地址：

```text
https://your-webdav-worker.your-workers-subdomain.workers.dev/
```

此项目经 Worker Binding 访问 R2，因此**不需要创建 R2 S3 API Token**，也不需要 VPS。若希望使用自己的域名，可在拥有活动 Cloudflare Zone 的前提下添加 Worker Custom Domain。[2]

## 修改用户名或密码

密码和用户名仅保存在 Cloudflare Worker Secrets。不要修改代码或 `wrangler.toml`。更新后客户端使用新的值即可，无需重新上传 Worker 代码。

```bash
npx wrangler secret put WEBDAV_PASSWORD
npx wrangler secret put WEBDAV_USERNAME
```

## curl 验证示例

将环境变量替换为自己的部署结果。上传文件时使用 `--data-binary`，防止 curl 修改换行符或截断二进制内容。

```bash
export DAV_URL='https://your-webdav-worker.your-workers-subdomain.workers.dev'
export DAV_USER='your-webdav-username'
export DAV_PASSWORD='your-webdav-password'

# 声明与认证
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X OPTIONS "$DAV_URL/"

# 创建目录
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X MKCOL "$DAV_URL/backups"
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X MKCOL "$DAV_URL/backups/mihomo"

# 上传或覆盖配置
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X PUT \
  --data-binary @config.yaml \
  -H 'Content-Type: application/yaml' \
  "$DAV_URL/backups/mihomo/config.yaml"

# 列目录，返回 207 Multi-Status XML
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X PROPFIND \
  -H 'Depth: 1' "$DAV_URL/backups/mihomo/"

# 下载与查看元数据
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X HEAD "$DAV_URL/backups/mihomo/config.yaml"
curl -f -u "$DAV_USER:$DAV_PASSWORD" -o restored.yaml \
  "$DAV_URL/backups/mihomo/config.yaml"

# 复制与移动
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X COPY \
  -H "Destination: $DAV_URL/backups/mihomo/config-copy.yaml" \
  -H 'Overwrite: F' \
  "$DAV_URL/backups/mihomo/config.yaml"
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X MOVE \
  -H "Destination: $DAV_URL/backups/mihomo/sing-box.json" \
  -H 'Overwrite: F' \
  "$DAV_URL/backups/mihomo/config-copy.yaml"

# 删除旧备份
curl -i -u "$DAV_USER:$DAV_PASSWORD" -X DELETE \
  "$DAV_URL/backups/mihomo/config.yaml"
```

## OpenList 配置

在 OpenList 管理后台新增存储时选择 **WebDAV**，然后填入实际部署后的根地址，不要额外附加 `webdav`、`dav` 等路径。根路径可使用 `/`；若只希望暴露备份内容，可填 `/backups`。

| OpenList 字段 | 建议值 |
|---|---|
| 驱动 | WebDAV |
| WebDAV 地址 | `https://your-webdav-worker.your-workers-subdomain.workers.dev/` |
| 用户名 | `WEBDAV_USERNAME` 的实际值 |
| 密码 | `WEBDAV_PASSWORD` 的实际值 |
| 根文件夹/路径 | `/` 或 `/backups` |
| TLS 证书验证 | 保持启用；不要跳过验证 |

## 免费额度与使用边界

本项目使用 R2 Standard 存储，以适用每月 **10 GB-month 存储、100 万次 Class A 与 1000 万次 Class B 操作**的 R2 免费额度；R2 到互联网的出口流量免费。[3] Workers Free 提供每天 **10 万请求**，每次 HTTP 调用最多 10 ms CPU。[1]

在轻量配置备份场景中，这些额度通常足够。若超出 R2 或 Workers Free 的免费额度，Cloudflare 可能拒绝后续请求或按照其计费规则处理；本项目不会自动启用付费功能。为避免大规模目录操作，`PROPFIND` 被限制为 `Depth: 0` 或 `Depth: 1`，每次直接子项列举最多为 1000 项。

## 本地验证

无需 Cloudflare 凭据即可执行模拟 R2 的完整核心流程测试：

```bash
npm run check
npm test
```

测试覆盖 `OPTIONS`、匿名拒绝、`MKCOL`、新建和覆盖 `PUT`、`PROPFIND` XML、`GET`、`HEAD`、`COPY`、`MOVE` 与 `DELETE`。

## 安全发布检查

发布仓库前，务必保持下列文件未被 Git 跟踪：`.deploy_credentials.json`、`.dev.vars`、`.cf_*`、`node_modules/`。本仓库的 `.gitignore` 已覆盖这些位置。绝不要提交实际的 `WEBDAV_USERNAME`、`WEBDAV_PASSWORD`、Cloudflare API Token 或任何 R2 S3 凭据。

## References

[1]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers limits"
[2]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "Cloudflare Workers Custom Domains"
[3]: https://developers.cloudflare.com/r2/pricing/ "Cloudflare R2 pricing"
