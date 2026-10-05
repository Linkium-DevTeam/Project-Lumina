# @linkium-devteam/lumina-api

微光 Lumina（AI 心灵陪伴者）的服务端 npm 发行版：单进程自托管，内置前端与 SQLite，无需 Docker、无需外部数据库。

## 运行

```bash
# 一次性体验（在任意空目录）
LUMINA_MASTER_KEY=$(openssl rand -base64 32) LUMINA_MOCK=true npx @linkium-devteam/lumina-api

# 全局安装后使用 lumina 命令
npm i -g @linkium-devteam/lumina-api
LUMINA_MASTER_KEY=$(openssl rand -base64 32) lumina
```

打开终端提示的地址（默认 http://localhost:8787）。

> GitHub Packages 的 npm 包即使公开也**需要认证安装**：先配置 PAT（勾选 `read:packages`），
> 在 `~/.npmrc` 写入 `//npm.pkg.github.com/:_authToken=YOUR_PAT`。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `LUMINA_MASTER_KEY` | **必填**，≥32 字节，密钥加密与 token 签名的主密钥 | — |
| `PORT` | 监听端口 | `8787` |
| `LUMINA_DB_PATH` | SQLite 数据文件路径（请备份） | `./data/lumina.db` |
| `LUMINA_MOCK` | `true` 启用内置演示提供商，无需真实 Key | `false` |
| `LUMINA_POOL_DAILY_LIMIT` | 互助模式每日配额 | `60` |
| `LUMINA_ALLOW_PRIVATE_UPSTREAM` | `true` 允许 ollama 等内网上游 | `false` |

完整配置与 API 见[仓库文档](https://github.com/Linkium-DevTeam/Project-Lumina)。

## 许可

Apache-2.0
