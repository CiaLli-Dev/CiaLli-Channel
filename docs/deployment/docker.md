# Docker 部署与运维

## 概览

本项目默认以单机 `docker compose` 部署，核心服务如下：

- `proxy`：站点入口与 HTTPS 终止
- `web`：Astro Node 服务
- `worker`：AI Summary Worker 与文件生命周期任务
- `directus`：CMS 与 API
- `postgres`：主数据库
- `redis`：缓存、限流与协调任务
- `minio`：对象存储

运行时文件存储只有一种形态：

- Directus 文件统一写入 MinIO，对应 `STORAGE_LOCATIONS=s3`
- 不挂载本地 uploads 目录，也没有 `local` 回退分支

默认访问约定：

- 主站由 `proxy` 对外暴露 `80/443`
- Directus 后台仅绑定 `127.0.0.1:8055`
- MinIO Console 仅绑定 `127.0.0.1:9001`

## 环境要求

建议环境：

- 生产服务器：Linux
- 本地验证：macOS 或 WSL
- 不建议把原生 Windows 作为安装器执行环境

所需工具：

- Docker Engine
- Docker Compose
- Git LFS
- Node.js `24.x`
- `pnpm`

首次安装前建议执行：

```bash
git lfs pull
```

安装器和 seed 校验都会检查 Git LFS；如果 `seed/postgres/demo.dump` 或 MinIO seed 仍是 pointer 文件，安装会直接失败。

## `.env` 约定

根目录 `.env` 是唯一真源，同时服务于：

- 本机脚本
- Docker Compose
- 运维排障

模板见 [`.env.example`](/Users/uednd/code/CiaLli-Channel/.env.example)。

当前部署会使用以下环境变量：

- `APP_PUBLIC_BASE_URL`
- `CADDY_ADDITIONAL_SITE_ADDRESS`
- `PUBLIC_ASSET_BASE_URL`
- `DIRECTUS_URL`
- `DIRECTUS_HOST_BIND`
- `DIRECTUS_HOST_PORT`
- `DIRECTUS_WEB_STATIC_TOKEN`
- `DIRECTUS_WORKER_STATIC_TOKEN`
- `DIRECTUS_SECRET`
- `POSTGRES_USER`
- `POSTGRES_DB`
- `POSTGRES_PASSWORD`
- `REDIS_URL`
- `REDIS_HOST_BIND`
- `REDIS_HOST_PORT`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_CONSOLE_HOST_BIND`
- `MINIO_CONSOLE_HOST_PORT`
- `DIRECTUS_ADMIN_EMAIL`
- `DIRECTUS_ADMIN_PASSWORD`
- `STORAGE_S3_KEY`
- `STORAGE_S3_SECRET`
- `APP_SECRET_ENCRYPTION_KEY`
- `AI_SUMMARY_INTERNAL_SECRET`
- `AI_SUMMARY_PROVIDER_TIMEOUT_MS`
- `FILE_GC_INTERVAL_MS`
- `FILE_GC_RETENTION_HOURS`
- `FILE_GC_QUARANTINE_DAYS`
- `FILE_GC_BATCH_SIZE`
- `FILE_GC_DELETE_MAX_ATTEMPTS`
- `FILE_DETACH_JOB_INTERVAL_MS`
- `FILE_DETACH_JOB_BATCH_SIZE`
- `FILE_DETACH_JOB_LEASE_SECONDS`
- `FILE_LIFECYCLE_RECONCILE_INTERVAL_MS`
- `FILE_REFERENCE_SHADOW_INTERVAL_MS`
- `WEB_HOST_BIND`
- `WEB_HOST_PORT`

其中：

- `APP_PUBLIC_BASE_URL` 是站点唯一公开入口真源，只支持根路径 URL，不支持子路径部署
- `DIRECTUS_URL` 与 `REDIS_URL` 主要用于宿主机脚本和本地调试
- `DIRECTUS_WEB_STATIC_TOKEN` 与 `DIRECTUS_WORKER_STATIC_TOKEN` 分别供 `web` 与 `worker` 使用
- `DIRECTUS_ADMIN_EMAIL` 与 `DIRECTUS_ADMIN_PASSWORD` 主要用于安装阶段与后台运维
- `PUBLIC_ASSET_BASE_URL` 留空时，资源继续统一走 BFF 代理
- `CADDY_ADDITIONAL_SITE_ADDRESS` 生产通常留空；本地 override 会使用 `http://`

校验现有 `.env`：

```bash
pnpm check:env
```

若要强制按生产标准校验占位值与密钥长度：

```bash
CHECK_ENV_STRICT=1 pnpm check:env
```

## 推荐安装

首次部署优先使用全局安装器：

```bash
pnpm install -g . && cialli-install install --site-url https://example.com
```

安装器会自动完成：

- 检查 Docker、Compose、Git LFS、端口与支持的平台
- 选择安装器语言，支持 `en`、`zh_CN`、`zh_TW`、`ja`
- 生成 `.env`、基础设施账号、密钥与静态 token
- 构建 `web` 与 `worker`
- 启动 `postgres`、`redis`、`minio`、`directus`
- 应用 Directus schema
- 初始化 Directus 管理员与服务账号
- 回填 `DIRECTUS_WEB_STATIC_TOKEN` 与 `DIRECTUS_WORKER_STATIC_TOKEN`
- 写入站点默认语言设置
- 启动 `web`、`worker`、`proxy`

非交互安装：

```bash
cialli-install install \
  --lang zh_CN \
  --site-url https://example.com
```

在仓库内直接调用本地安装器：

```bash
pnpm install:host --reset --lang zh_CN --site-url https://example.com
```

也兼容带参数分隔符的写法：

```bash
pnpm install:host -- --reset --lang zh_CN --site-url https://example.com
```

说明：

- 当前目录已有 `.env`、Compose 容器或 Compose volume 时，安装器默认拒绝覆盖
- 显式传入 `--reset` 后，安装器会执行 `docker compose down --volumes --remove-orphans` 并重新安装
- 当 `--site-url` 指向 `localhost`、`127.0.0.1` 或其他回环地址时，安装器会把 `https://` 自动收敛为 `http://`

## 本地验证与热更新

本地验证推荐使用回环地址：

```bash
pnpm install:host --reset --lang zh_CN --site-url http://localhost
```

本地热更新入口：

```bash
pnpm docker:build
pnpm docker:up
```

默认 `docker compose up` 会自动带上 [docker-compose.override.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.override.yml)：

- `web` 以 `pnpm exec astro dev --host 0.0.0.0 --port 4321` 运行
- `worker` 以 `pnpm exec tsx watch src/worker/ai-summary/server.ts` 运行
- 源码会挂载进容器，代码改动会触发热更新或重启

该入口仅用于本地开发与手动 QA，不作为生产部署流程。

## 生产部署

默认生产形态使用主 [docker-compose.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.yml)：

- `proxy` 暴露 `80/443`
- `web` 与 `worker` 使用构建产物运行
- `directus` 对宿主机仅暴露回环地址

如果宿主机已有 nginx 或其他反向代理负责 TLS 与公网入口，不要再启用 Compose 内置 `proxy`。可使用 [docker-compose.nginx.yml](/Users/uednd/code/CiaLli-Channel/docker-compose.nginx.yml)：

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d \
  postgres redis minio minio-init seed-postgres-restore seed-minio-restore directus web worker
```

此时：

- `web` 默认绑定到 `127.0.0.1:4321`
- `proxy` 只有在显式启用 `caddy-proxy` profile 时才会启动
- 可通过 `WEB_HOST_BIND` 与 `WEB_HOST_PORT` 调整 `web` 的宿主机回环绑定

nginx 反代时至少需要透传以下头：

```nginx
location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

同机多实例部署时，至少为每个实例分配独立的宿主机回环端口：

- `DIRECTUS_HOST_PORT`
- `REDIS_HOST_PORT`
- `MINIO_CONSOLE_HOST_PORT`
- `WEB_HOST_PORT`

## 演示 seed

仓库内置演示 seed，用于空白环境首次启动时恢复：

- PostgreSQL dump
- MinIO bucket 对象

当前恢复策略：

- `seed-postgres-restore` 仅在业务表尚未完成初始化时执行
- `seed-minio-restore` 仅在目标 bucket 为空时执行
- 目标环境已有数据时，恢复脚本会自动跳过，不覆盖现有内容

与 seed 相关的事实约束：

- PostgreSQL dump 位于 `seed/postgres/demo.dump`
- MinIO 对象目录位于 `seed/minio/demo-bucket`
- PostgreSQL seed dump 通过 Git LFS 分发
- `seed/metadata.json` 记录 dump 大小与 MinIO 对象数量
- 当前仓库要求 `seed/metadata.json`、`seed/postgres/demo.dump` 与 `directus/schema/app-schema.json` 始终保持一致

如需重新触发演示恢复：

- 删除 `postgres_data` 与 `minio_data` 对应的 Docker volume 后重新启动
- 或重新执行 `cialli-install install --reset`

## 访问与排障

默认访问方式：

- 主站：`APP_PUBLIC_BASE_URL`
- Directus 后台：宿主机 `127.0.0.1:8055`
- MinIO Console：宿主机 `127.0.0.1:9001`

建议：

- 生产环境访问 Directus 后台时，优先使用 SSH 隧道或宿主机本地访问
- 本地局域网调试时，可通过 `http://<本机局域网IP>/` 访问默认开发栈
- 若其他设备无法访问本地开发栈，优先检查宿主机防火墙是否放行 `80` 端口

## 备份与恢复

统一数据包命令：

```bash
pnpm docker:data:export
pnpm docker:data:verify backups/docker-data-20260422-153000.zip
pnpm docker:data:import backups/docker-data-20260422-153000.zip
```

可选参数：

```bash
pnpm docker:data:export --output backups/docker-data-20260422-153000.zip
pnpm docker:data:import backups/docker-data-20260422-153000.zip --backup-output backups/before-import-20260422-153500.zip
pnpm docker:data:import backups/docker-data-20260422-153000.zip --no-backup
```

导出包固定包含：

- `manifest.json`
- `postgres/directus.dump`
- `directus/schema.json`
- `minio/objects/**`
- `minio/objects-manifest.json`

恢复流程会：

- 先校验待导入 zip 包
- 默认先备份当前环境
- 停止 `web`、`worker`、`directus`
- 覆盖恢复 PostgreSQL 与 MinIO
- 重启服务并执行轻量校验

`--no-backup` 只会跳过“导入前自动备份当前环境”这一步，不会跳过 zip 包自身校验。

## 发布与升级建议

推荐顺序：

1. 执行 `pnpm docker:data:export` 备份当前环境
2. 应用最新 Directus schema
3. 重建并启动服务
4. 回归验证主站、后台、资源代理与 worker

常用命令：

```bash
pnpm directus:schema:apply
pnpm docker:build
pnpm docker:up:prod
```
