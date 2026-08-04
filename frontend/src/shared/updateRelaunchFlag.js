const KEY = "nemoris-post-update-relaunch";

// Survives the relaunch (unlike React/JS state) so the next process start
// can tell whether it exists because of a just-installed update.
export function markPostUpdateRelaunch() {
  try {
    localStorage.setItem(KEY, "1");
  } catch (error) {
    console.error(error);
  }
}

export function hasPostUpdateRelaunchFlag() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch (error) {
    console.error(error);
    return false;
  }
}

export function clearPostUpdateRelaunchFlag() {
  try {
    localStorage.removeItem(KEY);
  } catch (error) {
    console.error(error);
  }
}
