import * as path from "@std/path";
import { colors } from "@cliffy/ansi/colors";
import { CONFIG_DIR } from "../config/constants.ts";
import type { EventBroker } from "@env/env-event-stream";
import type {
  FileChangeEvent,
  FocusStateEvent,
  GitEvent,
} from "../types/index.ts";
import { Select } from "@cliffy/prompt";

export async function commandGenerateInsights(
  broker: EventBroker,
): Promise<void> {
  console.log(colors.blue("📊 Generating Development Insights"));

  // Get insights data from the event store
  const eventStore = broker.getEventStore();

  // Get file change events
  const fileEvents = await eventStore.getEvents("file.changes", {
    limit: 1000,
    fromTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  });

  // Get focus events
  const focusEvents = await eventStore.getEvents("focus.state", {
    limit: 100,
    fromTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  });

  // Get git events
  const gitEvents = await eventStore.getEvents("git.events", {
    limit: 100,
    fromTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // Last 7 days
  });

  // Analyze data
  // File changes by extension
  const extensionCounts = new Map<string, number>();
  for (const event of fileEvents) {
    const fileEvent = event.payload as FileChangeEvent;
    const ext = fileEvent.extension || "none";
    extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);
  }

  // Focus time
  let totalFocusTime = 0;
  let focusSessions = 0;
  for (const event of focusEvents) {
    if (event.type === "focus.started") {
      const focusEvent = event.payload as FocusStateEvent;
      if (focusEvent.duration) {
        totalFocusTime += focusEvent.duration;
        focusSessions++;
      }
    }
  }

  // Git activity
  let commits = 0;
  let pushes = 0;
  let pulls = 0;
  for (const event of gitEvents) {
    const gitEvent = event.payload as GitEvent;
    if (gitEvent.operation === "commit") commits++;
    if (gitEvent.operation === "push") pushes++;
    if (gitEvent.operation === "pull") pulls++;
  }

  // Display insights
  console.log(colors.green("\n📁 File Activity:"));
  console.log(`Total file changes: ${fileEvents.length}`);

  console.log("\nTop file extensions:");
  const sortedExtensions = Array.from(extensionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [ext, count] of sortedExtensions) {
    console.log(`  ${ext}: ${count}`);
  }

  console.log(colors.green("\n🧠 Focus Sessions:"));
  console.log(`Sessions: ${focusSessions}`);
  console.log(
    `Total focus time: ${Math.round(totalFocusTime / 60000)} minutes`,
  );

  console.log(colors.green("\n📊 Git Activity:"));
  console.log(`Commits: ${commits}`);
  console.log(`Pushes: ${pushes}`);
  console.log(`Pulls: ${pulls}`);

  // Offer to save report
  const saveReport = await Select.prompt({
    message: "Save insights report to file?",
    options: [
      { name: "Yes", value: "yes" },
      { name: "No", value: "no" },
    ],
  });

  if (saveReport === "yes") {
    const reportDir = path.join(CONFIG_DIR, "reports");
    await Deno.mkdir(reportDir, { recursive: true });

    const reportDate = new Date().toISOString().split("T")[0];
    const reportFile = path.join(reportDir, `insights-${reportDate}.md`);

    let report = `# DevStream Insights Report\n\n`;
    report += `Generated: ${new Date().toLocaleString()}\n\n`;

    report += `## File Activity\n\n`;
    report += `Total file changes: ${fileEvents.length}\n\n`;
    report += `Top file extensions:\n`;
    for (const [ext, count] of sortedExtensions) {
      report += `- ${ext}: ${count}\n`;
    }

    report += `\n## Focus Sessions\n\n`;
    report += `Sessions: ${focusSessions}\n`;
    report += `Total focus time: ${
      Math.round(totalFocusTime / 60000)
    } minutes\n`;

    report += `\n## Git Activity\n\n`;
    report += `Commits: ${commits}\n`;
    report += `Pushes: ${pushes}\n`;
    report += `Pulls: ${pulls}\n`;

    await Deno.writeTextFile(reportFile, report);
    console.log(colors.green(`\nReport saved to ${reportFile}`));
  }
}
