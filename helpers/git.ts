import type { EventBroker } from "@env/env-event-stream";
import type { GitEvent } from "../types/index.ts";

export const runGit = async (args: string[]): Promise<string> => {
  const command = new Deno.Command("git", {
    args: args,
    stdout: "piped",
    stderr: "piped",
  });

  const { stdout, stderr } = await command.output();
  const output = stdout;
  const error = stderr;

  if (error.length > 0) {
    throw new TextDecoder().decode(error);
  }

  return new TextDecoder().decode(output).trim();
};

export const checkGitStatus = async (
  broker: EventBroker,
  lastBranch: string,
  lastCommitHash: string,
) => {
  try {
    // Check for branch changes
    const currentBranch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (currentBranch !== lastBranch) {
      const gitEvent: GitEvent = {
        operation: "checkout",
        branch: currentBranch,
      };
      await broker.publish("git.events", "git.checkout", gitEvent);
      lastBranch = currentBranch;
    }

    // Check for new commits
    const currentCommitHash = await runGit(["rev-parse", "HEAD"]);
    if (currentCommitHash !== lastCommitHash) {
      // Get commit message
      const commitMessage = await runGit(["log", "-1", "--pretty=%B"]);

      const gitEvent: GitEvent = {
        operation: "commit",
        message: commitMessage,
        branch: currentBranch,
        hash: currentCommitHash,
      };
      await broker.publish("git.events", "git.commit", gitEvent);
      lastCommitHash = currentCommitHash;
    }
  } catch (error) {
    console.debug("Error checking git status:", error);
  }

  // Check again after delay
  setTimeout(() => checkGitStatus(broker, lastBranch, lastCommitHash), 5000);
};
