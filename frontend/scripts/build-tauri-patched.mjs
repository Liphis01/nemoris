import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PATCH_MARKER = "# Nemoris AppImage graphics compatibility patch";
const WAYLAND_LIB_PATTERN = /^libwayland-(client|cursor|egl|server)\.so/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
    );
  }
}

function stripNpmSeparator(args) {
  return args.filter((arg) => arg !== "--");
}

function newestEntry(entries) {
  return entries
    .map((entry) => ({
      ...entry,
      mtimeMs: fs.statSync(entry.path).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function walkFiles(root, matcher, matches = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, matcher, matches);
    } else if (matcher(entryPath, entry.name)) {
      matches.push(entryPath);
    }
  }
  return matches;
}

function findBundlePaths() {
  const bundleDir = path.join(
    process.cwd(),
    "src-tauri",
    "target",
    "release",
    "bundle",
    "appimage",
  );
  if (!fs.existsSync(bundleDir)) {
    throw new Error(`AppImage bundle directory not found: ${bundleDir}`);
  }

  const entries = fs.readdirSync(bundleDir, { withFileTypes: true });
  const appDirEntry = newestEntry(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".AppDir"))
      .map((entry) => ({ name: entry.name, path: path.join(bundleDir, entry.name) })),
  );
  const appImageEntry = newestEntry(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".AppImage"))
      .map((entry) => ({ name: entry.name, path: path.join(bundleDir, entry.name) })),
  );

  if (!appDirEntry) {
    throw new Error(`No .AppDir found in ${bundleDir}`);
  }
  if (!appImageEntry) {
    throw new Error(`No .AppImage found in ${bundleDir}`);
  }

  return {
    appDir: appDirEntry.path,
    appImage: appImageEntry.path,
  };
}

function appDirRelative(appDir, filePath) {
  return path.relative(appDir, filePath).split(path.sep).join("/");
}

function normalizeGioExtraModules(appDir, hook) {
  const moduleFiles = walkFiles(
    appDir,
    (_filePath, name) => name === "libgiognutls.so",
  );
  const moduleDirs = [
    ...new Set(
      moduleFiles.map((filePath) => `$APPDIR/${appDirRelative(appDir, path.dirname(filePath))}`),
    ),
  ];

  if (moduleDirs.length === 0) {
    return hook;
  }

  const exportLine = `export GIO_EXTRA_MODULES="${moduleDirs.join(":")}"\n`;
  if (/export GIO_EXTRA_MODULES="[\s\S]*?"\n?/.test(hook)) {
    return hook.replace(/export GIO_EXTRA_MODULES="[\s\S]*?"\n?/, exportLine);
  }
  return `${hook.trimEnd()}\n${exportLine}`;
}

function removeLegacyCompositingFallback(hook) {
  return hook.replace(
    /^export WEBKIT_DISABLE_COMPOSITING_MODE="\$\{WEBKIT_DISABLE_COMPOSITING_MODE:-1\}"\n?/m,
    "",
  );
}

function patchGtkHook(appDir) {
  const hookPath = path.join(appDir, "apprun-hooks", "linuxdeploy-plugin-gtk.sh");
  if (!fs.existsSync(hookPath)) {
    throw new Error(`GTK AppRun hook not found: ${hookPath}`);
  }

  let hook = fs.readFileSync(hookPath, "utf8");
  hook = hook.split(appDir).join("$APPDIR");
  hook = normalizeGioExtraModules(appDir, hook);
  hook = removeLegacyCompositingFallback(hook);

  if (!hook.includes(PATCH_MARKER)) {
    const patchBlock = `${PATCH_MARKER}
export WEBKIT_DISABLE_DMABUF_RENDERER="\${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"

nemoris_preload_system_wayland_client() {
  if [ -n "\${NEMORIS_DISABLE_SYSTEM_WAYLAND_PRELOAD:-}" ]; then
    return 0
  fi

  for candidate in \\
    /usr/lib/x86_64-linux-gnu/libwayland-client.so.0 \\
    /usr/lib64/libwayland-client.so.0 \\
    /usr/lib/libwayland-client.so.0
  do
    if [ -r "$candidate" ]; then
      case " \${LD_PRELOAD:-} " in
        *" $candidate "*) ;;
        *) export LD_PRELOAD="$candidate\${LD_PRELOAD:+ $LD_PRELOAD}" ;;
      esac
      return 0
    fi
  done

  if command -v ldconfig >/dev/null 2>&1; then
    candidate="$(ldconfig -p 2>/dev/null | awk '/libwayland-client[.]so[.]0/{print $NF; exit}')"
    if [ -n "$candidate" ] && [ -r "$candidate" ]; then
      export LD_PRELOAD="$candidate\${LD_PRELOAD:+ $LD_PRELOAD}"
    fi
  fi
}

nemoris_preload_system_wayland_client
`;
    hook = hook.replace(/^#![^\n]*\n/, (shebang) => `${shebang}\n${patchBlock}\n`);
  }

  fs.writeFileSync(hookPath, hook);
}

function removeBundledWaylandLibraries(appDir) {
  const libDir = path.join(appDir, "usr", "lib");
  if (!fs.existsSync(libDir)) {
    return [];
  }

  const removed = [];
  for (const entry of fs.readdirSync(libDir)) {
    if (!WAYLAND_LIB_PATTERN.test(entry)) {
      continue;
    }
    const libraryPath = path.join(libDir, entry);
    fs.rmSync(libraryPath, { force: true });
    removed.push(entry);
  }
  return removed;
}

function findAppImagePlugin() {
  const configured = process.env.NEMORIS_APPIMAGE_PLUGIN;
  if (configured) {
    return configured;
  }

  const cached = path.join(
    os.homedir(),
    ".cache",
    "tauri",
    "linuxdeploy-plugin-appimage.AppImage",
  );
  if (fs.existsSync(cached)) {
    return cached;
  }

  return "linuxdeploy-plugin-appimage";
}

function repackAppImage(appDir, appImage) {
  const plugin = findAppImagePlugin();
  const tempOutput = `${appImage}.patched`;
  fs.rmSync(tempOutput, { force: true });

  run(plugin, ["--appdir", appDir], {
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: process.env.APPIMAGE_EXTRACT_AND_RUN ?? "1",
      LDAI_OUTPUT: tempOutput,
    },
  });

  fs.renameSync(tempOutput, appImage);
}

function hasSigningKey() {
  return Boolean(
    process.env.TAURI_SIGNING_PRIVATE_KEY ||
      process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,
  );
}

function signArtifact(filePath) {
  run("npm", ["run", "tauri", "--", "signer", "sign", filePath]);
}

function recreateTarballIfPresent(appImage) {
  const tarball = `${appImage}.tar.gz`;
  if (!fs.existsSync(tarball)) {
    return null;
  }

  fs.rmSync(tarball, { force: true });
  run("tar", ["czf", tarball, "-C", path.dirname(appImage), path.basename(appImage)]);
  return tarball;
}

function refreshUpdaterSignatures(appImage) {
  const tarball = recreateTarballIfPresent(appImage);

  if (!hasSigningKey()) {
    for (const signature of [`${appImage}.sig`, tarball && `${tarball}.sig`].filter(Boolean)) {
      fs.rmSync(signature, { force: true });
    }
    console.warn(
      "TAURI_SIGNING_PRIVATE_KEY is not set; removed stale Linux updater signatures.",
    );
    return;
  }

  signArtifact(appImage);
  if (tarball) {
    signArtifact(tarball);
  }
}

function assertPatched(appDir, appImage) {
  const hookPath = path.join(appDir, "apprun-hooks", "linuxdeploy-plugin-gtk.sh");
  const hook = fs.readFileSync(hookPath, "utf8");
  if (!hook.includes(PATCH_MARKER)) {
    throw new Error("GTK AppRun hook was not patched");
  }
  if (hook.includes(appDir)) {
    throw new Error("GTK AppRun hook still contains the build-machine AppDir path");
  }
  if (
    /^export WEBKIT_DISABLE_COMPOSITING_MODE="\$\{WEBKIT_DISABLE_COMPOSITING_MODE:-1\}"/m.test(hook)
  ) {
    throw new Error("GTK AppRun hook still forces WebKit compositing fallback");
  }

  const libDir = path.join(appDir, "usr", "lib");
  const bundledWayland = fs
    .readdirSync(libDir)
    .filter((entry) => WAYLAND_LIB_PATTERN.test(entry));
  if (bundledWayland.length > 0) {
    throw new Error(
      `Bundled Wayland libraries were not removed: ${bundledWayland.join(", ")}`,
    );
  }

  fs.accessSync(appImage, fs.constants.X_OK);
}

function main() {
  const tauriArgs = stripNpmSeparator(process.argv.slice(2));
  if (tauriArgs[0] !== "build") {
    throw new Error(
      `This wrapper only supports "build"; received: ${tauriArgs.join(" ")}`,
    );
  }

  run("npm", ["run", "tauri", "--", ...tauriArgs]);

  if (process.platform !== "linux") {
    return;
  }

  const { appDir, appImage } = findBundlePaths();
  patchGtkHook(appDir);
  const removed = removeBundledWaylandLibraries(appDir);
  console.log(
    `Patched Linux AppImage launcher and removed ${removed.length} bundled Wayland libraries.`,
  );
  repackAppImage(appDir, appImage);
  refreshUpdaterSignatures(appImage);
  assertPatched(appDir, appImage);
}

main();
