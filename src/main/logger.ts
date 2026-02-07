import log from "electron-log/main";

const isDev = !!process.env.VITE_DEV_SERVER_URL;

log.transports.file.level = "info";
log.transports.file.maxSize = 5 * 1024 * 1024;

log.transports.console.level = isDev ? "debug" : "warn";

export default log;
