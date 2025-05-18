import * as path from "@std/path";
import type { EventBroker } from "@env/env-event-stream";
import type { FileChangeEvent } from "../types/index.ts";

export const shouldIgnore = (path: string, ignorePaths: string[]): boolean => {
  return ignorePaths.some((ignore) => path.includes(ignore));
};

export const scanDir = async (
  dirPath: string,
  ignorePaths: string[],
  fileMap: Map<string, { mtime: number; size: number }>,
) => {
  for await (const entry of Deno.readDir(dirPath)) {
    const entryPath = path.join(dirPath, entry.name);

    if (shouldIgnore(entryPath, ignorePaths)) continue;

    if (entry.isDirectory) {
      await scanDir(entryPath, ignorePaths, fileMap);
    } else if (entry.isFile) {
      try {
        const stat = await Deno.stat(entryPath);
        fileMap.set(entryPath, {
          mtime: stat.mtime?.getTime() || 0,
          size: stat.size,
        });
      } catch (err) {
        // File might have been deleted while scanning
        console.debug(`Error stating file ${entryPath}:`, err);
      }
    }
  }
};

export const watchDir = async (
  broker: EventBroker,
  dir: string,
  ignorePaths: string[],
): Promise<void> => {
  try {
    // Get initial snapshot of files (needed to compare for modifications)
    const fileMap = new Map<string, { mtime: number; size: number }>();
    await scanDir(dir, ignorePaths, fileMap);

    // Start watching
    const watcher = Deno.watchFs(dir);
    console.log(`Watching directory: ${dir}`);

    for await (const event of watcher) {
      for (const path of event.paths) {
        if (shouldIgnore(path, ignorePaths)) continue;

        try {
          const extension = path.split(".").pop() || "";

          if (event.kind === "create" || event.kind === "modify") {
            const stat = await Deno.stat(path);
            const fileEvent: FileChangeEvent = {
              path,
              operation: event.kind,
              extension,
              size: stat.size,
            };

            // If it's a modification, check if file actually changed
            if (event.kind === "modify") {
              const previous = fileMap.get(path);
              if (
                previous && previous.mtime === stat.mtime?.getTime() &&
                previous.size === stat.size
              ) {
                continue; // Skip if no actual change
              }

              // Update the file map
              fileMap.set(path, {
                mtime: stat.mtime?.getTime() || 0,
                size: stat.size,
              });
            }

            broker.publish("file.changes", `file.${event.kind}`, fileEvent);
          } else if (event.kind === "remove") {
            const fileEvent: FileChangeEvent = {
              path,
              operation: "delete",
              extension,
            };
            broker.publish("file.changes", "file.delete", fileEvent);
            fileMap.delete(path);
          }
        } catch (err) {
          // File might be temporarily locked or unavailable
          console.debug(`Error processing ${path}:`, err);
        }
      }
    }
  } catch (error) {
    console.error(`Error watching directory ${dir}:`, error);
  }
};
