import type { EventBroker } from "@env/env-event-stream";
import type {
  BuildEvent,
  FileChangeEvent,
  OptimizedBuildConfig,
} from "../types/index.ts";
import buildFiles from "../config/buildFiles.json" with { type: "json" };

export async function handleBuildFileChange(
  broker: EventBroker,
  fileName: string,
  fileEvent: FileChangeEvent,
  language?: string,
): Promise<void> {
  console.log(
    `Build file ${fileName}${
      language ? ` (${language})` : ""
    } was ${fileEvent.operation}d`,
  );

  // Publish a build file change event
  const buildEvent: BuildEvent = {
    operation: "start",
    buildFile: fileName,
    language,
  };
  await broker.publish("build.events", "build.file_change", buildEvent);
}

export function preprocessBuildConfig(): OptimizedBuildConfig {
  const buildFileLookup = new Map<string, boolean>();
  const buildFilePatterns: Array<[RegExp, string]> = [];

  // Process all build file entries into our optimized structures
  for (const [language, files] of Object.entries(buildFiles)) {
    for (const file of files as string[]) {
      // Handle glob patterns like "*.csproj" by converting to regex
      if (file.includes("*")) {
        const regexPattern = new RegExp(`^${file.replace("*", ".*")}$`, "i");
        buildFilePatterns.push([regexPattern, language]);
      } else {
        // Direct exact matches go into our O(1) lookup Map
        buildFileLookup.set(file, true);
      }
    }
  }

  return {
    patterns: buildFilePatterns,
    lookup: buildFileLookup,
  };
}
