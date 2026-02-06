import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";
import pkg from "./package.json";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
  rmSync("dist-electron", { recursive: true, force: true });

  const isServe = command === "serve";
  const isBuild = command === "build";
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;
  const externalDependencies = Object.keys(pkg.dependencies ?? {});

  return {
    resolve: {
      alias: {
        "@renderer": path.join(__dirname, "src/renderer/src"),
        "@shared": path.join(__dirname, "src/shared"),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      electron({
        main: {
          entry: "src/main/index.ts",
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: "dist-electron/main",
              rollupOptions: {
                external: externalDependencies,
              },
            },
          },
        },
        preload: {
          input: "src/preload/index.ts",
          vite: {
            build: {
              sourcemap: sourcemap ? "inline" : undefined,
              minify: isBuild,
              outDir: "dist-electron/preload",
              rollupOptions: {
                external: externalDependencies,
              },
            },
          },
        },
        renderer: {},
      }),
    ],
    clearScreen: false,
  };
});
