import { Preferences } from "@capacitor/preferences";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const STATE_KEY = "nemoris-mobile-state";
const TOKEN_KEY = "nemoris-sync-token";

export const DEFAULT_MOBILE_STATE = {
  serverUrl: "",
  serverKey: "",
  accountEmail: null,
  deviceId: null,
  lastServerVersion: 0,
  localChangeSeq: 0,
  lastSyncedChangeSeq: 0,
  activeSession: null,
  lastSyncStatus: null,
  lastSyncError: null
};

export function collectionIsDirty(state: any) {
  return Number(state?.localChangeSeq || 0) > Number(state?.lastSyncedChangeSeq || 0);
}

export function ensureDeviceId(state: any, random = crypto.randomUUID.bind(crypto)) {
  return state.deviceId ? state : { ...state, deviceId: random().replace(/-/g, "") };
}

export async function loadMobileState() {
  const result = await Preferences.get({ key: STATE_KEY });
  if (!result.value) return { ...DEFAULT_MOBILE_STATE };
  try {
    return { ...DEFAULT_MOBILE_STATE, ...JSON.parse(result.value) };
  } catch {
    return { ...DEFAULT_MOBILE_STATE };
  }
}

export async function saveMobileState(state: any) {
  await Preferences.set({ key: STATE_KEY, value: JSON.stringify(state) });
  return state;
}

export async function markMobileCollectionChanged(reason = "review") {
  const state = await loadMobileState();
  const next = {
    ...state,
    localChangeSeq: Number(state.localChangeSeq || 0) + 1,
    lastLocalChangeReason: reason
  };
  return saveMobileState(next);
}

export async function markMobileCollectionClean(version?: number) {
  const state = await loadMobileState();
  const next = {
    ...state,
    ...(version !== undefined ? { lastServerVersion: version } : {}),
    lastSyncedChangeSeq: Number(state.localChangeSeq || 0)
  };
  return saveMobileState(next);
}

export async function loadSyncToken() {
  return SecureStorage.get(TOKEN_KEY, false);
}

export async function saveSyncToken(token: any) {
  if (!token) {
    await SecureStorage.remove(TOKEN_KEY);
    return null;
  }
  await SecureStorage.set(TOKEN_KEY, token, false);
  return token;
}

export async function clearMobileState() {
  await Preferences.remove({ key: STATE_KEY });
  await SecureStorage.remove(TOKEN_KEY);
}

