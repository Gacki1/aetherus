import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// For desktop build, bundle EVERYTHING so the .exe is self-contained
// Only keep truly native/built-in Node modules as external
const nativeExternals = [
  "crypto",
  "fs",
  "http",
  "https",
  "net",
  "os",
  "path",
  "stream",
  "url",
  "util",
  "zlib",
  "tls",
  "events",
  "buffer",
  "string_decoder",
  "querystring",
  "child_process",
  "worker_threads",
  "assert",
  "tty",
  "dns",
  "dgram",
  "cluster",
  "module",
  "readline",
  "vm",
  "v8",
  "perf_hooks",
  "async_hooks",
  "inspector",
  "diagnostics_channel",
  "node:crypto",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:os",
  "node:path",
  "node:stream",
  "node:url",
  "node:util",
  "node:zlib",
  "node:tls",
  "node:events",
  "node:buffer",
  "node:string_decoder",
  "node:querystring",
  "node:child_process",
  "node:worker_threads",
  "node:assert",
  "node:tty",
  "node:dns",
  "node:dgram",
  "node:cluster",
  "node:module",
  "node:readline",
  "node:vm",
  "node:v8",
  "node:perf_hooks",
  "node:async_hooks",
  "node:inspector",
  "node:diagnostics_channel",
];

async function buildDesktop() {
  // Only rebuild the server bundle (client is already built)
  console.log("building desktop server bundle (all deps included)...");

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/desktop-index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: nativeExternals,
    logLevel: "info",
  });

  console.log("Desktop server bundle built successfully!");
}

buildDesktop().catch((err) => {
  console.error(err);
  process.exit(1);
});
