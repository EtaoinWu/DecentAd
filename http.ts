import { Application, Router } from "oak";
import * as log from "log";

export async function start_server() {
  const logger = log.getLogger("http");
  const app = new Application();

  const router = new Router();
  router.get("/", (ctx) => {
    ctx.response.body = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Title</title>
    </head>
    <body>
      Hi!
    </body>
    </html>`;
  });

  // Error handling
  app.addEventListener("error", (evt) => {
    logger.error(evt.error);
  });

  // Logger
  app.use(async (ctx, next) => {
    await next();
    const rt = ctx.response.headers.get("X-Response-Time");
    logger.info(`${ctx.request.method} ${ctx.request.url} - ${rt}`);
  });

  // Timing
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.response.headers.set("X-Response-Time", `${ms}ms`);
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  await app.listen({ hostname: "127.0.0.1", port: 8000 });
}
