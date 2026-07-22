import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const backendCommandPattern = /(^|[\\/ ])nemoris-backend(?:$|[.\s-])/i;
const selfPattern = /stop-nemoris-backend\.mjs/i;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function commandMatches(command) {
  return backendCommandPattern.test(command) && !selfPattern.test(command);
}

function linuxPidsFromProc() {
  const pids = [];

  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;

      const pid = Number(entry.name);
      if (pid === process.pid || pid === process.ppid) continue;

      let command = "";
      try {
        command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
        if (!command.trim()) {
          command = readFileSync(`/proc/${pid}/comm`, "utf8");
        }
      } catch {
        continue;
      }

      if (commandMatches(command)) {
        pids.push(pid);
      }
    }
  } catch {
    return [];
  }

  return pids;
}

function commandForPid(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8"
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function unixPidsFromPgrep() {
  const result = spawnSync("pgrep", ["-f", "nemoris-backend"], {
    encoding: "utf8"
  });

  if (result.status !== 0) return [];

  return result.stdout
    .split(/\s+/)
    .map(Number)
    .filter(Number.isInteger)
    .filter((pid) => pid !== process.pid && pid !== process.ppid)
    .filter((pid) => commandMatches(commandForPid(pid)));
}

function stopUnixBackend() {
  const pids = [...new Set([...linuxPidsFromProc(), ...unixPidsFromPgrep()])];
  if (pids.length === 0) return false;

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pids.some(pidExists)) {
    sleep(100);
  }

  for (const pid of pids.filter(pidExists)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }

  console.log(`Stopped Nemoris backend process${pids.length === 1 ? "" : "es"}: ${pids.join(", ")}`);
  return true;
}

function stopWindowsBackend() {
  const psCommand = [
    "$procs = Get-Process | Where-Object { $_.ProcessName -like 'nemoris-backend*' };",
    "if ($procs) {",
    "  $ids = $procs.Id -join ', ';",
    "  $procs | Stop-Process -Force;",
    "  Write-Output $ids;",
    "}"
  ].join(" ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
    { encoding: "utf8" }
  );

  if (result.status === 0 && result.stdout.trim()) {
    console.log(`Stopped Nemoris backend processes: ${result.stdout.trim()}`);
    return true;
  }

  const fallback = spawnSync("taskkill", ["/F", "/T", "/IM", "nemoris-backend*.exe"], {
    encoding: "utf8"
  });

  if (fallback.status === 0) {
    console.log("Stopped Nemoris backend processes.");
    return true;
  }

  return false;
}

if (process.platform === "win32") {
  stopWindowsBackend();
} else {
  stopUnixBackend();
}
