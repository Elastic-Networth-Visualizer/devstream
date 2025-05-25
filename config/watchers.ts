import * as path from "@std/path";
import type { EventBroker } from "@env/env-event-stream";
import {
  checkGitStatus,
  handleBuildFileChange,
  preprocessBuildConfig,
  runGit,
  watchDir,
} from "../helpers/index.ts";
import type { FileChangeEvent } from "../types/index.ts";

export function watchFiles(
  broker: EventBroker,
  dirs: string[],
  ignorePaths: string[],
): Promise<void> {
  return new Promise((resolve) => {
    if (!broker.getTopic("file.changes")) {
      broker.createTopic("file.changes");
    }
    // Start watching all directories
    for (const dir of dirs) {
      watchDir(broker, dir, ignorePaths).catch(console.error);
    }
    resolve();
  });
}

export async function watchGit(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("git.events")) {
    broker.createTopic("git.events");
  }

  // Get current git status
  let lastCommitHash = "";
  let lastBranch = "";

  try {
    lastCommitHash = await runGit(["rev-parse", "HEAD"]);
    lastBranch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch (error) {
    console.debug("Git repository not initialized:", error);
    return; // Not a git repository
  }

  // Start checking git status periodically
  checkGitStatus(
    broker,
    lastBranch,
    lastCommitHash,
  );
}

export function watchBuilds(broker: EventBroker): void {
  if (!broker.getTopic("build.events")) {
    broker.createTopic("build.events");
  }

  const { lookup, patterns } = preprocessBuildConfig();

  // Subscribe to file changes related to build files
  broker.subscribe("file.changes", async (event) => {
    const fileEvent = event.payload as FileChangeEvent;
    const fileName = path.basename(fileEvent.path);

    // Fast path: O(1) lookup for exact matches
    if (lookup.has(fileName)) {
      await handleBuildFileChange(broker, fileName, fileEvent);
      return;
    }

    // Slow path (only for files that might match patterns): Check regex patterns
    // This is only needed for the small subset of files with patterns like *.csproj
    for (const [pattern, language] of patterns) {
      if (pattern.test(fileName)) {
        await handleBuildFileChange(broker, fileName, fileEvent, language);
        return;
      }
    }
  }, { eventTypes: ["file.create", "file.modify"] });
}
