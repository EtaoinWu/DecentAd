import * as log from "log";
import { start_server } from "./http.ts";
import { format } from "datetime";

await log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: function (record) {
        let logger_name_infix = "";
        if (record.loggerName != "default") {
          logger_name_infix = ` <${record.loggerName}>`;
        }
        return `${
          format(record.datetime, "yyyy-MM-dd HH:mm:ss.SSS")
        } [${record.levelName}]${logger_name_infix} ${record.msg}`;
      },
    }),
  },
  loggers: {
    default: {
      level: "DEBUG",
      handlers: ["console"],
    },
    http: {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});

log.info("Starting server...");
await start_server();
