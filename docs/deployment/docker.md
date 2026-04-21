# Docker 部署

## 架构

生产部署默认使用单机 `docker compose`，服务拓扑如下：

- `proxy`：统一处理站点入口与 HTTPS 终止
- `web`：Astro Node 服务
- `worker`：AI Summary Worker
- `directus`：CMS 与 API
- `postgres`：Directus 主数据库
- `redis`：缓存、限流与分布式刷新协调
- `minio`：对象存储

当前运行时仅保留对象存储：

- `s3`：新上传与历史迁移后的文件统一走 MinIO
- 历史 local 文件已迁移完成，运行时不再挂载 local uploads 目录

Directus 后台默认只绑定到 `127.0.0.1:8055`，不直接暴露公网。

## 准备环境变量

1. 根目录 [`.env.example`](/Users/uednd/code/CiaLli-Channel/.env.example) 是唯一环境变量模板，复制为 `.env` 后统一维护。
2. 同一份 `.env` 同时服务于：
   本机脚本 / 开发调试
   Docker Compose
3. 容器内互联地址通过以下变量和主机侧地址区分，但仍都写在同一个 `.env` 中：
   `DIRECTUS_URL` / `DIRECTUS_INTERNAL_URL`
   `REDIS_URL` / `REDIS_INTERNAL_URL`
4. 生产环境至少需要显式配置：
   `APP_PUBLIC_BASE_URL`
   `DIRECTUS_STATIC_TOKEN`
   `BANGUMI_TOKEN_ENCRYPTION_KEY`
   `REDIS_NAMESPACE`
   `AI_SUMMARY_INTERNAL_SECRET`
   `DIRECTUS_SECRET`
   `DIRECTUS_KEY`
   `DIRECTUS_ADMIN_EMAIL`
   `DIRECTUS_ADMIN_PASSWORD`
   `POSTGRES_PASSWORD`
   `MINIO_ROOT_PASSWORD`

建议在启动前先执行：

```bash
pnpm check:env
```

本地环境默认会放宽对占位值的检查；如需在 CI 或正式发版前强制按生产标准校验，可使用：

```bash
CHECK_ENV_STRICT=1 pnpm check:env
```

## 本地热更新启动

```bash
pnpm docker:build
pnpm docker:up
```

仓库提供 [docker-compose.override.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.override.yml) 作为本地开发覆盖配置。使用默认 `docker compose up` 时，`web` 会以 `pnpm dev` 运行并挂载源码，`worker` 会以 `tsx watch` 运行，代码改动会自动热更新或重启。

## 生产启动

生产环境需要显式绕过本地 override，只加载主 [docker-compose.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.yml)：

```bash
pnpm docker:build
pnpm docker:up:prod
```

等价的原生命令是：

```bash
docker compose -f docker-compose.yml up -d
```

首次启动会自动完成：

- PostgreSQL 初始化
- Redis 启动
- MinIO bucket 创建
- Directus 数据库迁移与管理员初始化

## 访问

- 主站通过 `proxy` 对外暴露 `80/443`
- Directus 后台仅绑定 `127.0.0.1:8055`
- MinIO Console 仅绑定 `127.0.0.1:9001`

如需访问 Directus 后台，建议使用 SSH 隧道或在服务器本机浏览器访问。

## 升级顺序

1. 备份 PostgreSQL 与 MinIO 数据
2. 应用 Directus schema 变更
3. 重建镜像并滚动 `web` / `worker`
4. 回归验证主站、资源代理、AI worker 与后台健康状态

## 历史文件迁移

本仓库提供一次性迁移脚本，将 `directus_files.storage='local'` 的历史文件迁移到对象存储：

```bash
pnpm files:migrate:local-to-s3:dry-run
pnpm files:migrate:local-to-s3
```

迁移脚本会自动：

- 备份本地数据库
- 备份当前 uploads volume
- 上传历史文件到 MinIO
- 成功后把 `directus_files.storage` 更新为 `s3`
- 写出 JSON 迁移报告与回滚 SQL

迁移完成并验证无误后，运行时配置应收敛为仅 `s3`。
