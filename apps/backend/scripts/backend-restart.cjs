#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");

function resolvePort() {
  const raw = (process.env.PORT || "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return 3000;
}

function listListeningPids(port) {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    {
      encoding: "utf8"
    }
  );

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.warn("[backend:restart] lsof is not available, skip port cleanup.");
      return [];
    }
    throw result.error;
  }

  if (!result.stdout.trim()) {
    return [];
  }

  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    )
  ];
}

function signalPids(pids, signal) {
  for (const pid of pids) {
    const result = spawnSync("kill", [signal, String(pid)], { encoding: "utf8" });
    if (result.status !== 0 && !result.stderr.includes("No such process")) {
      console.warn(
        `[backend:restart] failed to send ${signal} to pid ${pid}: ${result.stderr.trim()}`
      );
    }
  }
}

function restartBackend() {
  const port = resolvePort();
  const pids = listListeningPids(port);
  if (pids.length > 0) {
    console.log(
      `[backend:restart] port ${port} is in use, stopping pids: ${pids.join(", ")}`
    );
    signalPids(pids, "-TERM");
    const remaining = listListeningPids(port);
    if (remaining.length > 0) {
      signalPids(remaining, "-KILL");
    }
  }

  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["run", "dev"], {
    stdio: "inherit",
    env: process.env
  });

  child.on("error", (error) => {
    console.error(`[backend:restart] failed to start dev server: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

restartBackend();
