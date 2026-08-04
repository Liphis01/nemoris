import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { markPostUpdateRelaunch } from "../shared/updateRelaunchFlag";

export function checkForUpdate() {
  return invoke("check_for_update");
}

// On Windows install_update never actually resolves (the process exits
// directly to hand off to the installer), so relaunch() only matters on
// platforms where the app isn't force-closed as part of the install step.
export async function installUpdate(onProgress) {
  const unlisten = onProgress
    ? await listen("update://progress", (event) => {
        const [chunkLength, contentLength] = event.payload;
        onProgress(chunkLength, contentLength);
      })
    : null;

  // Set before the install starts, not after: on Windows the process can
  // exit mid-install to hand off to the installer, so code placed after
  // invoke("install_update") below would never run.
  markPostUpdateRelaunch();

  try {
    await invoke("install_update");
    await relaunch();
  } finally {
    unlisten?.();
  }
}
