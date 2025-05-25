// deno-lint-ignore-file no-explicit-any
import {
  EventBroker,
  FileDeadLetterQueue,
  FileEventStore,
} from "@env/env-event-stream";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  DLQ_DIR,
  EVENT_STORE_DIR,
} from "../config/constants.ts";
import type { NotificationEvent } from "../types/index.ts";

export async function initBroker(): Promise<EventBroker> {
  // Ensure config directory exists
  try {
    await Deno.mkdir(CONFIG_DIR, { recursive: true });
    await Deno.mkdir(EVENT_STORE_DIR, { recursive: true });
    await Deno.mkdir(DLQ_DIR, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      console.error("Failed to create config directories:", error);
      Deno.exit(1);
    }
  }

  // Load or create config
  let config = DEFAULT_CONFIG;
  try {
    const configText = await Deno.readTextFile(CONFIG_FILE);
    config = JSON.parse(configText);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      await Deno.writeTextFile(
        CONFIG_FILE,
        JSON.stringify(DEFAULT_CONFIG, null, 2),
      );
    } else {
      console.error("Error reading config:", error);
    }
  }

  // Create event store and DLQ
  const eventStore = new FileEventStore(EVENT_STORE_DIR);
  const deadLetterQueue = new FileDeadLetterQueue(DLQ_DIR);

  // Create broker with our storage
  const broker = new EventBroker(eventStore, deadLetterQueue);

  // Initialize topics from config
  for (const [topicName, options] of Object.entries(config.topics)) {
    broker.createTopic(topicName, options);
  }

  return broker;
}

export const convertFromBytes = (
  bytes: number,
  unit: "KB" | "MB" | "GB" = "KB",
): number => {
  const unitsMap = {
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  };

  if (!unitsMap[unit]) {
    throw new Error(`Invalid unit: ${unit}`);
  }
  return bytes / unitsMap[unit];
};

export function generateDailySummary(
  insightsData: any,
  broker: EventBroker,
): void {
  // Build summary message
  let summary = "📊 Your Development Summary for Today\n\n";

  // File changes
  const totalFileChanges = Array.from(
    insightsData.fileChanges.byExtension.values(),
  )
    .reduce((total, count) => (total as number) + (count as number), 0);

  summary += `📝 File Changes: ${totalFileChanges}\n`;

  // Top file extensions
  const sortedExtensions = (Array.from(
    insightsData.fileChanges.byExtension.entries(),
  ) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sortedExtensions.length > 0) {
    summary += "Top file types:\n";
    for (const [ext, count] of sortedExtensions) {
      summary += `  - ${ext}: ${count}\n`;
    }
  }

  // Focus sessions
  const focusSessions = insightsData.focus.sessions.length;
  const totalFocusTimeMinutes = Math.floor(
    insightsData.focus.totalDuration / 60000,
  );

  summary += `\n🧠 Focus Sessions: ${focusSessions}\n`;
  summary += `⏱️ Total Focus Time: ${totalFocusTimeMinutes} minutes\n`;

  // Git activity
  summary += `\n📊 Git Activity:\n`;
  summary += `  - Commits: ${insightsData.git.commits}\n`;
  summary += `  - Pushes: ${insightsData.git.pushes}\n`;
  summary += `  - Pulls: ${insightsData.git.pulls}\n`;

  // Send as a notification
  const notificationEvent: NotificationEvent = {
    level: "info",
    message: summary,
    source: "Insights",
    actionable: false,
  };

  broker.publish("notification", "notification.insights", notificationEvent);

  // Reset counters for the next day
  insightsData.fileChanges.byExtension.clear();
  insightsData.git.commits = 0;
  insightsData.git.pushes = 0;
  insightsData.git.pulls = 0;
  insightsData.focus.sessions = [];
  insightsData.focus.totalDuration = 0;
}
