import { invoke } from "@tauri-apps/api/core";

type PersistedConfig = {
  save_path: string;
};

function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:[\\/]$/.test(path);
}

export function buildDefaultSavePath(directory: string, fileName: string): string {
  const trimmedDirectory = directory.trim();
  if (!trimmedDirectory) {
    return fileName;
  }

  if (/[\\/]$/.test(trimmedDirectory)) {
    return `${trimmedDirectory}${fileName}`;
  }

  const separator = trimmedDirectory.includes("\\") ? "\\" : "/";
  return `${trimmedDirectory}${separator}${fileName}`;
}

export function extractDirectoryPath(filePath: string): string | null {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    return null;
  }

  if (/[\\/]$/.test(trimmedPath)) {
    return trimmedPath;
  }

  const separatorIndex = Math.max(
    trimmedPath.lastIndexOf("\\"),
    trimmedPath.lastIndexOf("/")
  );

  if (separatorIndex < 0) {
    return null;
  }

  if (separatorIndex === 0) {
    return trimmedPath.slice(0, 1);
  }

  const directory = trimmedPath.slice(0, separatorIndex);
  if (isWindowsDriveRoot(directory)) {
    return directory;
  }

  if (/^[A-Za-z]:$/.test(directory)) {
    return `${directory}\\`;
  }

  return directory;
}

export async function persistLastUsedSaveDirectory(filePath: string): Promise<void> {
  const directory = extractDirectoryPath(filePath);
  if (!directory) {
    return;
  }

  try {
    const config = await invoke<PersistedConfig & Record<string, unknown>>("load_config");
    if (config.save_path === directory) {
      return;
    }

    await invoke("save_config", {
      config: {
        ...config,
        save_path: directory,
      },
    });
  } catch (error) {
    console.warn("Failed to persist last used save directory:", error);
  }
}
