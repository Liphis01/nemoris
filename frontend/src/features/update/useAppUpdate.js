import { useCallback, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, installUpdate } from "../../api/updater";

export function useAppUpdate() {
  const [status, setStatus] = useState("idle"); // idle | checking | available | installing | error
  const [updateInfo, setUpdateInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");

  const check = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setStatus("checking");
      setError("");
    }

    try {
      const [info, version] = await Promise.all([
        checkForUpdate(),
        getVersion()
      ]);

      setCurrentVersion(version);
      setUpdateInfo(info);
      setStatus(info ? "available" : "idle");
    } catch (checkError) {
      console.error(checkError);

      if (!silent) {
        setError(checkError.message || "Vérification impossible.");
        setStatus("error");
      }
    }
  }, []);

  const install = useCallback(async () => {
    setStatus("installing");
    setError("");
    setProgress(null);

    let downloaded = 0;

    try {
      await installUpdate((chunkLength, contentLength) => {
        downloaded += chunkLength;
        setProgress({ downloaded, total: contentLength });
      });
    } catch (installError) {
      console.error(installError);
      setError(installError.message || "Mise à jour impossible.");
      setStatus("error");
    }
  }, []);

  return {
    status,
    updateInfo,
    progress,
    error,
    currentVersion,
    check,
    install
  };
}
