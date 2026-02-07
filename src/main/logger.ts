import log from "electron-log/main";

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const env = process.env.VITEST ? "test" : isDev ? "dev" : "prod";

log.transports.file.level = "info";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [${env}] {text}`;

log.transports.console.level = isDev ? "debug" : "warn";
log.transports.console.format = `[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [${env}] {text}`;

export default log;
