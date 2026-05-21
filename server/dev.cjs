const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const apiBin = path.join(__dirname, "api.cjs");
const viteHost = process.env.VITE_HOST || process.env.HOST || "127.0.0.1";

const children = [];

function spawnChild(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    console.log(`[${name}] exited with ${signal || code}`);
    shutdown(code || 1);
  });

  children.push(child);
}

let shuttingDown = false;

function shutdown(code) {
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
  setTimeout(() => process.exit(code), 120);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

spawnChild("api", process.execPath, [apiBin]);
spawnChild("vite", process.execPath, [viteBin, "--host", viteHost]);
