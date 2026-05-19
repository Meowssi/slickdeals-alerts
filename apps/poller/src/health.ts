// Tiny HTTP server exposing /healthz for Fly's TCP health checks.

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config.js";
import { log } from "./log.js";

export function startHealthServer(): { close: () => void } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(config.port, () => {
    log.info("health server listening", { port: config.port });
  });
  return { close: () => server.close() };
}
