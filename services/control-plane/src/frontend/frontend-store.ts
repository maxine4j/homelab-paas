import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { UiUnavailableError } from "./frontend-service.ts";
import type { UiEntry, UiFiles } from "./frontend-service.ts";

/** Filesystem adapter. Never follows a symlink beneath the configured UI root. */
export class DirectoryUiFiles implements UiFiles {
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }

  async inspect(path: string): Promise<UiEntry> {
    if (
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => part.startsWith("."))
    )
      return "blocked";
    let current = resolve(this.directory);
    let file = false;
    try {
      for (const component of path.split("/").filter(Boolean)) {
        current = resolve(current, component);
        const info = await lstat(current);
        if (info.isSymbolicLink()) return "blocked";
        file = info.isFile();
      }
      return file ? "file" : "missing";
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(String(error.code))
      )
        return "missing";
      throw new UiUnavailableError({ cause: error });
    }
  }
}
