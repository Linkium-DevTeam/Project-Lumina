# 微光 Lumina — 生产镜像（单进程：API + 静态前端 + 内置 SQLite）
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY lumina-api/package.json lumina-api/
COPY lumina-web/package.json lumina-web/
RUN npm ci
COPY lumina-api/ lumina-api/
COPY lumina-web/ lumina-web/
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# 运行时依赖只装 lumina-api（workspaces 提升 → 根 node_modules）
COPY package.json package-lock.json ./
COPY lumina-api/package.json ./lumina-api/package.json
RUN npm ci --omit=dev --workspace lumina-api
COPY --from=build /app/lumina-api/dist ./lumina-api/dist
COPY --from=build /app/lumina-web/dist ./lumina-web/dist
WORKDIR /app/lumina-api
EXPOSE 8787
VOLUME ["/app/lumina-api/data"]
CMD ["node", "dist/index.js"]
