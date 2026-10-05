import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertMasterKey, config } from "./config.js";
import { buildApp } from "./app.js";

assertMasterKey();

const app = buildApp();

// ── 单进程托管前端静态资源（自托管 = 一条命令）──
const webDist = resolve(process.cwd(), "../lumina-web/dist");

app.use("*", serveStatic({ root: webDist }));

app.get("*", async (c) => {
  // SPA 回退：非 API 路径统一回 index.html
  if (c.req.path.startsWith("/api/")) {
    return c.json({ success: false, code: "NOT_FOUND", message: "接口不存在", data: null }, 404);
  }
  const indexPath = resolve(webDist, "index.html");
  if (!existsSync(indexPath)) {
    return c.text("lumina-web 尚未构建：请先运行 npm run build", 404);
  }
  const html = await readFile(indexPath, "utf8");
  return c.html(html);
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`
  🕯️  微光 Lumina v2.0 已点亮
      本机访问   http://localhost:${info.port}
      数据文件   ${config.dbPath}
      演示模式   ${config.mock ? "开启（mock 提供商）" : "关闭"}
  `);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log("\n[lumina] 吹灭蜡烛，晚安。");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
