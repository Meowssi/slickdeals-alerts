// Poller entrypoint.

import { log } from "./log.js";
import { runScheduler } from "./scheduler.js";
import { startHealthServer } from "./health.js";

const controller = new AbortController();

function shutdown(signal: string): void {
  log.info("shutdown requested", { signal });
  controller.abort();
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (err) => {
  log.error("unhandledRejection", { error: String(err) });
});
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { error: String(err) });
});

startHealthServer();
runScheduler(controller.signal).catch((err) => {
  log.error("scheduler exited with error", { error: String(err) });
  process.exit(1);
});
