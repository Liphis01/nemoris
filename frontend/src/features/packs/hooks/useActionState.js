import { useState } from "react";

// Shared busy/error-per-key state for list rows with independent async
// actions (install, update, rate, unpublish, ...). Keyed by whatever id
// the caller uses (pack_guid, etc).
export function useActionState() {
  const [state, setState] = useState({});

  function patch(key, delta) {
    setState((previous) => ({
      ...previous,
      [key]: { ...previous[key], ...delta }
    }));
  }

  return [state, patch];
}
