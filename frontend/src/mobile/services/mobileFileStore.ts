import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

const DB_PATH = "nemoris/questions.db";
const MEDIA_PREFIX = "nemoris/static";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function readMobileDatabaseFile() {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path: DB_PATH
    });
    return base64ToBytes(String(result.data || ""));
  } catch {
    return null;
  }
}

export async function writeMobileDatabaseFile(bytes: Uint8Array) {
  await Filesystem.mkdir({
    directory: Directory.Data,
    path: "nemoris",
    recursive: true
  }).catch(() => {});
  await Filesystem.writeFile({
    directory: Directory.Data,
    path: DB_PATH,
    data: bytesToBase64(bytes)
  });
}

function writePathDirectory(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

export function mobileMediaPathFromRegistryPath(path: string) {
  const value = String(path || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^static\//, "");
  const relative = value.replace(/^\/+/, "");
  return relative ? `${MEDIA_PREFIX}/${relative}` : null;
}

export function staticMediaPathFromMedia(media: string) {
  const value = String(media || "").trim();
  if (!value.startsWith("/static/")) return null;
  return mobileMediaPathFromRegistryPath(value.slice("/static/".length));
}

export async function writeMobileMediaFile(media: string, bytes: Uint8Array) {
  const path = staticMediaPathFromMedia(media);
  if (!path) return null;
  const directory = writePathDirectory(path);
  if (directory) {
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: directory,
      recursive: true
    }).catch(() => {});
  }
  await Filesystem.writeFile({
    directory: Directory.Data,
    path,
    data: bytesToBase64(bytes)
  });
  return path;
}

export async function writeMobileMediaPath(relativePath: string, bytes: Uint8Array) {
  const path = mobileMediaPathFromRegistryPath(relativePath);
  if (!path) return null;
  const directory = writePathDirectory(path);
  if (directory) {
    await Filesystem.mkdir({
      directory: Directory.Data,
      path: directory,
      recursive: true
    }).catch(() => {});
  }
  await Filesystem.writeFile({
    directory: Directory.Data,
    path,
    data: bytesToBase64(bytes)
  });
  return path;
}

export async function readMobileMediaFile(media: string) {
  const path = staticMediaPathFromMedia(media);
  if (!path) return null;
  return readMobilePrivateFile(path);
}

export async function readMobileMediaPath(relativePath: string) {
  const path = mobileMediaPathFromRegistryPath(relativePath);
  if (!path) return null;
  return readMobilePrivateFile(path);
}

export async function mobileMediaPathExists(relativePath: string) {
  const path = mobileMediaPathFromRegistryPath(relativePath);
  if (!path) return false;
  try {
    await Filesystem.stat({
      directory: Directory.Data,
      path
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveMobileMediaUrl(media: string) {
  const value = String(media || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const path = staticMediaPathFromMedia(value);
  if (!path) return value;

  try {
    await Filesystem.stat({ directory: Directory.Data, path });
    const result = await Filesystem.getUri({ directory: Directory.Data, path });
    return Capacitor.convertFileSrc(result.uri);
  } catch {
    return null;
  }
}

async function readMobilePrivateFile(path: string) {
  try {
    const result = await Filesystem.readFile({
      directory: Directory.Data,
      path
    });
    return base64ToBytes(String(result.data || ""));
  } catch {
    return null;
  }
}
