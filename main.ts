#!/usr/bin/env -S deno run --watch --allow-read --allow-write --allow-net --allow-env --allow-run
// deno-lint-ignore-file require-await no-explicit-any
import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import type { EventBroker } from "@env/env-event-stream";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";
import { Input, Select } from "@cliffy/prompt";
import * as path from "@std/path";
import {
  checkGitStatus,
  handleBuildFileChange,
  initBroker,
  isInSilentHours,
  preprocessBuildConfig,
  runGit,
  watchDir,
} from "./helpers/index.ts";
import type {
AutomationConfig,
  FileChangeEvent,
  FocusStateEvent,
  GitEvent,
  NotificationEvent,
  WorkflowEvent,
} from "./types/index.ts";
import { CONFIG_DIR, CONFIG_FILE } from "./config/constants.ts";

// File watcher to detect changes
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

// Git watcher to detect git operations
async function watchGit(broker: EventBroker): Promise<void> {
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

// Function to watch build systems
async function watchBuilds(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("build.events")) {
    broker.createTopic("build.events");
  }

  const { lookup, patterns } = await preprocessBuildConfig();

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

// Function to handle notifications based on focus mode
async function setupNotifications(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("notification")) broker.createTopic("notification");
  if (!broker.getTopic("focus.state")) broker.createTopic("focus.state");

  // Get config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  // Track focus state
  let inFocusMode = config.notification.focusMode;

  // Function to check if message is high priority
  const isHighPriority = (message: string): boolean => {
    return config.notification.priorityPatterns.some(
      (pattern: string) =>
        message.toLowerCase().includes(pattern.toLowerCase()),
    );
  };

  // Subscribe to notification events
  broker.subscribe("notification", async (event) => {
    const notificationEvent = event.payload as NotificationEvent;

    // Skip non-priority notifications during focus mode
    if (inFocusMode && !isHighPriority(notificationEvent.message)) {
      console.debug(
        `Suppressing notification during focus mode: ${notificationEvent.message}`,
      );
      return;
    }

    // Skip non-priority notifications during silent hours
    if (isInSilentHours(config) && !isHighPriority(notificationEvent.message)) {
      console.debug(
        `Suppressing notification during silent hours: ${notificationEvent.message}`,
      );
      return;
    }

    // Display notification
    const levelColors = {
      "info": colors.blue,
      "warning": colors.yellow,
      "error": colors.red,
      "success": colors.green,
    };

    const colorFn = levelColors[notificationEvent.level] || colors.white;
    console.log(
      colorFn(`[${notificationEvent.source}] ${notificationEvent.message}`),
    );

    // On macOS, we can use the built-in notification system
    if (Deno.build.os === "darwin") {
      try {
        const command = new Deno.Command("osascript", {
          args: [
            "-e",
            `display notification "${notificationEvent.message}" with title "DevStream: ${notificationEvent.source}"`,
          ],
        });
        await command.output();
      } catch (error) {
        console.debug("Error showing macOS notification:", error);
      }
    }
  });

  // Subscribe to focus state changes
  broker.subscribe("focus.state", (event) => {
    const focusEvent = event.payload as FocusStateEvent;
    inFocusMode = focusEvent.state === "focus";

    // Update config
    config.notification.focusMode = inFocusMode;
    Deno.writeTextFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    console.log(
      inFocusMode
        ? colors.green(
          "🧠 Focus mode activated - only priority notifications will be shown",
        )
        : colors.blue(
          "Focus mode deactivated - all notifications will be shown",
        ),
    );
  });
}

// Function to run workflow automations
async function setupAutomations(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("workflow.automation")) {
    broker.createTopic("workflow.automation");
  }

  // Read automations from config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const {automations} = JSON.parse(configText) as { automations: AutomationConfig[] };

  for (const automation of automations) {
    // Create a subscription for each automation
    broker.subscribe(automation.trigger.topic, async (event) => {
      // Check if event type matches
      if (
        automation.trigger.eventType &&
        event.type !== automation.trigger.eventType
      ) {
        return;
      }

      // Check condition if specified
      if (automation.trigger.condition) {
        // Simple pattern matching on payload
        const payload = JSON.stringify(event.payload);
        if (!payload.includes(automation.trigger.condition)) {
          return;
        }
      }

      console.log(colors.magenta(`Executing automation: ${automation.name}`));

      // Publish workflow start event
      const workflowEvent: WorkflowEvent = {
        name: automation.name,
        trigger: event.type,
        action: automation.action.type,
        status: "started",
      };

      await broker.publish(
        "workflow.automation",
        "workflow.started",
        workflowEvent,
      );

      try {
        // Execute the action
        if (automation.action.type === "command") {
          const cmd = automation.action.command.split(" ");
          const command = new Deno.Command(cmd[0], {
            args: cmd.slice(1),
            stdout: "piped",
            stderr: "piped",
          });

          const { success, stderr } = await command.output();

          if (!success) {
            throw new Error(new TextDecoder().decode(stderr));
          }

          // Publish success notification
          const notificationEvent: NotificationEvent = {
            level: "success",
            message: `Automation "${automation.name}" completed successfully`,
            source: "Automation",
            actionable: false,
          };

          await broker.publish(
            "notification",
            "notification.automation",
            notificationEvent,
          );

          // Publish workflow completion event
          const completionEvent: WorkflowEvent = {
            name: automation.name,
            trigger: event.type,
            action: automation.action.type,
            status: "completed",
          };

          await broker.publish(
            "workflow.automation",
            "workflow.completed",
            completionEvent,
          );
        }
      } catch (error: any) {
        console.error(
          `Error executing automation "${automation.name}":`,
          error,
        );

        // Publish failure notification
        const notificationEvent: NotificationEvent = {
          level: "error",
          message: `Automation "${automation.name}" failed: ${error.message}`,
          source: "Automation",
          actionable: true,
          actions: ["View logs", "Edit automation"],
        };

        await broker.publish(
          "notification",
          "notification.automation",
          notificationEvent,
        );

        // Publish workflow failure event
        const failureEvent: WorkflowEvent = {
          name: automation.name,
          trigger: event.type,
          action: automation.action.type,
          status: "failed",
          error: error.message,
        };

        await broker.publish(
          "workflow.automation",
          "workflow.failed",
          failureEvent,
        );
      }
    });
  }
}

// Function to collect and analyze development patterns
async function setupInsights(broker: EventBroker): Promise<void> {
  // Check if insights are enabled
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  if (!config.insights.collectStats) {
    return;
  }

  // Create insights data structure
  const insightsData = {
    fileChanges: {
      byExtension: new Map<string, number>(),
      byHour: new Map<number, number>(),
      byDay: new Map<string, number>(),
    },
    focus: {
      sessions: [] as { start: number; end: number; duration: number }[],
      totalDuration: 0,
    },
    git: {
      commits: 0,
      pushes: 0,
      pulls: 0,
    },
  };

  // Listen to file changes for insights
  broker.subscribe("file.changes", (event) => {
    const fileEvent = event.payload as FileChangeEvent;

    // Count by extension
    if (fileEvent.extension) {
      const current =
        insightsData.fileChanges.byExtension.get(fileEvent.extension) || 0;
      insightsData.fileChanges.byExtension.set(
        fileEvent.extension,
        current + 1,
      );
    }

    // Count by hour
    const hour = new Date().getHours();
    const hourCount = insightsData.fileChanges.byHour.get(hour) || 0;
    insightsData.fileChanges.byHour.set(hour, hourCount + 1);

    // Count by day
    const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const dayCount = insightsData.fileChanges.byDay.get(day) || 0;
    insightsData.fileChanges.byDay.set(day, dayCount + 1);
  });

  // Listen to focus events
  broker.subscribe("focus.state", (event) => {
    const focusEvent = event.payload as FocusStateEvent;

    if (focusEvent.state === "focus" && focusEvent.duration) {
      insightsData.focus.sessions.push({
        start: focusEvent.startTime,
        end: focusEvent.endTime || Date.now(),
        duration: focusEvent.duration,
      });

      insightsData.focus.totalDuration += focusEvent.duration;
    }
  });

  // Listen to git events
  broker.subscribe("git.events", (event) => {
    const gitEvent = event.payload as GitEvent;

    if (gitEvent.operation === "commit") {
      insightsData.git.commits++;
    } else if (gitEvent.operation === "push") {
      insightsData.git.pushes++;
    } else if (gitEvent.operation === "pull") {
      insightsData.git.pulls++;
    }
  });

  // If daily summary is enabled, schedule it
  if (config.insights.dailySummary) {
    // Check every hour if it's time for a summary
    setInterval(() => {
      const now = new Date();

      // If it's 6 PM, generate a summary
      if (now.getHours() === 18) {
        generateDailySummary(insightsData, broker);
      }
    }, 60 * 60 * 1000); // Check every hour
  }
}

// Generate a daily summary of development activity
function generateDailySummary(
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

// Command to list active topics and subscriptions
async function commandListTopics(broker: EventBroker): Promise<void> {
  const topics = broker.getTopicNames();

  console.log(colors.blue("📋 Active Topics:"));
  for (const topicName of topics) {
    const topic = broker.getTopic(topicName);
    if (!topic) continue;

    const subscriptions = topic?.getSubscriptions() || [];
    console.log(
      `${colors.green(topicName)} (${subscriptions.length} subscriptions)`,
    );

    if (subscriptions.length > 0) {
      for (const sub of subscriptions) {
        const eventTypes = sub.getEventTypes();
        const eventTypesStr = eventTypes && eventTypes.length > 0
          ? `[${eventTypes.join(", ")}]`
          : "[all events]";

        console.log(`  - ${sub.getId()} ${eventTypesStr}`);
      }
    }
  }
}

// Command to view recent events
async function commandViewEvents(
  broker: EventBroker,
  args: any,
): Promise<void> {
  const topics = broker.getTopicNames();

  // If no topic specified, show a menu
  let selectedTopic = args.topic;
  if (!selectedTopic) {
    selectedTopic = await Select.prompt({
      message: "Select a topic to view events",
      options: topics,
    });
  } else if (!topics.includes(selectedTopic)) {
    console.error(colors.red(`Topic "${selectedTopic}" does not exist`));
    return;
  }

  // Get the events
  const limit = args.limit || 10;
  const eventStore = broker.getEventStore();
  const events = await eventStore.getEvents(selectedTopic, { limit });

  console.log(
    colors.blue(
      `📋 Recent Events for "${selectedTopic}" (showing ${events.length}):`,
    ),
  );

  if (events.length === 0) {
    console.log(colors.yellow("No events found"));
    return;
  }

  // Create a table to display events
  const table = new Table();
  table.header(["Timestamp", "Type", "Payload"]);

  for (const event of events) {
    const date = new Date(event.timestamp).toLocaleString();
    const payload = JSON.stringify(event.payload).substring(0, 50) +
      (JSON.stringify(event.payload).length > 50 ? "..." : "");

    table.push([date, event.type, payload]);
  }

  table.render();

  // Option to view a specific event in detail
  if (events.length > 0) {
    const view = await Select.prompt({
      message: "View details of an event?",
      options: [
        { name: "No", value: "no" },
        ...events.map((event, index) => ({
          name: `Event ${index + 1}: ${event.type}`,
          value: index.toString(),
        })),
      ],
    });

    if (view !== "no") {
      const eventIndex = parseInt(view);
      const event = events[eventIndex];

      console.log(colors.blue(`\n📋 Event Details:`));
      console.log(colors.green(`ID: ${event.id}`));
      console.log(colors.green(`Type: ${event.type}`));
      console.log(colors.green(`Topic: ${event.topic}`));
      console.log(
        colors.green(
          `Timestamp: ${new Date(event.timestamp).toLocaleString()}`,
        ),
      );
      console.log(colors.green(`Schema Version: ${event.schemaVersion}`));
      console.log(colors.green("Payload:"));
      console.log(JSON.stringify(event.payload, null, 2));

      if (event.metadata) {
        console.log(colors.green("Metadata:"));
        console.log(JSON.stringify(event.metadata, null, 2));
      }
    }
  }
}

// Command to view and manage the dead letter queue
async function commandManageDLQ(broker: EventBroker): Promise<void> {
  const deadLetterQueue = broker.getDeadLetterQueue();
  const entries = await deadLetterQueue.getEvents();

  console.log(colors.blue(`📋 Dead Letter Queue Events (${entries.length}):`));

  if (entries.length === 0) {
    console.log(colors.green("No failed events in the queue"));
    return;
  }

  // Create a table to display DLQ entries
  const table = new Table();
  table.header(["ID", "Topic", "Type", "Error", "Attempts", "Timestamp"]);

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleString();
    table.push([
      entry.event.id.substring(0, 8) + "...",
      entry.event.topic,
      entry.event.type,
      entry.error.substring(0, 30) + (entry.error.length > 30 ? "..." : ""),
      entry.attempts.toString(),
      date,
    ]);
  }

  table.render();

  // Offer options to manage DLQ
  const action = await Select.prompt({
    message: "What would you like to do?",
    options: [
      { name: "Exit", value: "exit" },
      { name: "Retry an event", value: "retry" },
      { name: "Remove an event", value: "remove" },
      { name: "Retry all events", value: "retry_all" },
    ],
  });

  if (action === "exit") {
    return;
  } else if (action === "retry") {
    const eventIndex = await Select.prompt({
      message: "Select an event to retry",
      options: entries.map((entry, index) => ({
        name: `${index + 1}: ${entry.event.type} (${entry.event.topic})`,
        value: index.toString(),
      })),
    });

    const entry = entries[parseInt(eventIndex)];
    await broker.retryDeadLetterEvent(entry.event.id);
    console.log(colors.green(`Event ${entry.event.id} queued for retry`));
  } else if (action === "remove") {
    const eventIndex = await Select.prompt({
      message: "Select an event to remove",
      options: entries.map((entry, index) => ({
        name: `${index + 1}: ${entry.event.type} (${entry.event.topic})`,
        value: index.toString(),
      })),
    });

    const entry = entries[parseInt(eventIndex)];
    await deadLetterQueue.removeEvent(entry.event.id);
    console.log(
      colors.green(`Event ${entry.event.id} removed from dead letter queue`),
    );
  } else if (action === "retry_all") {
    const confirm = await Select.prompt({
      message: "Are you sure you want to retry all events?",
      options: [
        { name: "Yes", value: "yes" },
        { name: "No", value: "no" },
      ],
    });

    if (confirm === "yes") {
      let retryCount = 0;
      for (const entry of entries) {
        await broker.retryDeadLetterEvent(entry.event.id);
        retryCount++;
      }
      console.log(colors.green(`${retryCount} events queued for retry`));
    }
  }
}

// Command to toggle focus mode
async function commandToggleFocus(broker: EventBroker): Promise<void> {
  // First check current state
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);
  const currentFocusMode = config.notification.focusMode;

  // Ask for focus duration if entering focus mode
  if (!currentFocusMode) {
    const duration = await Input.prompt({
      message: "Enter focus session duration in minutes (default: 25)",
      default: "25",
    });

    // Convert to milliseconds
    const durationMs = parseInt(duration) * 60 * 1000;

    // Create focus event
    const focusEvent: FocusStateEvent = {
      state: "focus",
      startTime: Date.now(),
      duration: durationMs,
    };

    // Publish focus started event
    await broker.publish("focus.state", "focus.started", focusEvent);

    console.log(
      colors.green(`🧠 Focus mode activated for ${duration} minutes`),
    );

    // Schedule end of focus session
    setTimeout(async () => {
      // Create focus end event
      const endEvent: FocusStateEvent = {
        state: "available",
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
      };

      // Publish focus ended event
      await broker.publish("focus.state", "focus.ended", endEvent);

      console.log(colors.blue("🔔 Focus session completed"));

      // Show notification
      const notificationEvent: NotificationEvent = {
        level: "success",
        message: "Focus session completed! Take a short break.",
        source: "Focus Timer",
        actionable: false,
      };

      await broker.publish(
        "notification",
        "notification.focus",
        notificationEvent,
      );
    }, durationMs);
  } else {
    // End focus mode
    const endEvent: FocusStateEvent = {
      state: "available",
      startTime: Date.now(),
      endTime: Date.now(),
      duration: 0,
    };

    // Publish focus ended event
    await broker.publish("focus.state", "focus.ended", endEvent);

    console.log(colors.blue("Focus mode deactivated"));
  }
}

// Command to create a new automation
async function commandCreateAutomation(broker: EventBroker): Promise<void> {
  console.log(colors.blue("📋 Create New Automation"));

  // Get automation details from user
  const name = await Input.prompt({
    message: "Enter automation name",
  });

  // Select trigger topic
  const topics = broker.getTopicNames();
  const triggerTopic = await Select.prompt({
    message: "Select trigger topic",
    options: topics,
  });

  // Get event type (optional)
  const useEventType = await Select.prompt({
    message: "Filter by event type?",
    options: [
      { name: "Yes", value: "yes" },
      { name: "No", value: "no" },
    ],
  });

  let eventType = "";
  if (useEventType === "yes") {
    eventType = await Input.prompt({
      message: "Enter event type (e.g., file.create, git.commit)",
    });
  }

  // Get condition (optional)
  const useCondition = await Select.prompt({
    message: "Add condition filter?",
    options: [
      { name: "Yes", value: "yes" },
      { name: "No", value: "no" },
    ],
  });

  let condition = "";
  if (useCondition === "yes") {
    condition = await Input.prompt({
      message: "Enter condition text (will be matched in the event payload)",
    });
  }

  // Get action command
  const command = await Input.prompt({
    message: "Enter command to execute",
  });

  // Create automation
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  const automation = {
    name,
    trigger: {
      topic: triggerTopic,
      eventType: eventType || undefined,
      condition: condition || undefined,
    },
    action: {
      type: "command",
      command,
    },
  };

  config.automations.push(automation);

  // Save config
  await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log(colors.green(`Automation "${name}" created successfully!`));

  // Reload automations
  await setupAutomations(broker);
}

// Command to generate insights report
async function commandGenerateInsights(broker: EventBroker): Promise<void> {
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

// Command to configure DevStream settings
async function commandConfigure(): Promise<void> {
  console.log(colors.blue("⚙️ Configure DevStream"));

  // Load current config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  // Show configuration menu
  const section = await Select.prompt({
    message: "Select section to configure",
    options: [
      { name: "Watch Directories", value: "watchDirs" },
      { name: "Ignore Patterns", value: "ignorePaths" },
      { name: "Notification Settings", value: "notification" },
      { name: "Insights Settings", value: "insights" },
    ],
  });

  if (section === "watchDirs") {
    console.log(colors.green("Current watch directories:"));
    for (const dir of config.watchDirs) {
      console.log(`  - ${dir}`);
    }

    const action = await Select.prompt({
      message: "Action",
      options: [
        { name: "Add directory", value: "add" },
        { name: "Remove directory", value: "remove" },
      ],
    });

    if (action === "add") {
      const newDir = await Input.prompt({
        message: "Enter directory path",
      });

      if (!config.watchDirs.includes(newDir)) {
        config.watchDirs.push(newDir);
        console.log(colors.green(`Added ${newDir} to watch list`));
      } else {
        console.log(colors.yellow(`${newDir} is already in watch list`));
      }
    } else if (action === "remove") {
      const dirToRemove = await Select.prompt({
        message: "Select directory to remove",
        options: config.watchDirs,
      });

      config.watchDirs = config.watchDirs.filter((dir: string) =>
        dir !== dirToRemove
      );
      console.log(colors.green(`Removed ${dirToRemove} from watch list`));
    }
  } else if (section === "ignorePaths") {
    console.log(colors.green("Current ignore patterns:"));
    for (const pattern of config.ignorePaths) {
      console.log(`  - ${pattern}`);
    }

    const action = await Select.prompt({
      message: "Action",
      options: [
        { name: "Add ignore pattern", value: "add" },
        { name: "Remove ignore pattern", value: "remove" },
      ],
    });

    if (action === "add") {
      const newPattern = await Input.prompt({
        message: "Enter ignore pattern",
      });

      if (!config.ignorePaths.includes(newPattern)) {
        config.ignorePaths.push(newPattern);
        console.log(colors.green(`Added ${newPattern} to ignore list`));
      } else {
        console.log(colors.yellow(`${newPattern} is already in ignore list`));
      }
    } else if (action === "remove") {
      const patternToRemove = await Select.prompt({
        message: "Select pattern to remove",
        options: config.ignorePaths,
      });

      config.ignorePaths = config.ignorePaths.filter((pattern: string) =>
        pattern !== patternToRemove
      );
      console.log(colors.green(`Removed ${patternToRemove} from ignore list`));
    }
  } else if (section === "notification") {
    console.log(colors.green("Notification settings:"));
    console.log(
      `  Focus mode: ${config.notification.focusMode ? "Enabled" : "Disabled"}`,
    );
    console.log(
      `  Silent hours: ${config.notification.silentHours.start} - ${config.notification.silentHours.end}`,
    );

    const setting = await Select.prompt({
      message: "Select setting to change",
      options: [
        { name: "Silent hours", value: "silentHours" },
        { name: "Priority patterns", value: "priorityPatterns" },
      ],
    });

    if (setting === "silentHours") {
      const startTime = await Input.prompt({
        message: "Enter start time (HH:MM)",
        default: config.notification.silentHours.start,
      });

      const endTime = await Input.prompt({
        message: "Enter end time (HH:MM)",
        default: config.notification.silentHours.end,
      });

      config.notification.silentHours = { start: startTime, end: endTime };
      console.log(
        colors.green(`Silent hours updated to ${startTime} - ${endTime}`),
      );
    } else if (setting === "priorityPatterns") {
      console.log(colors.green("Current priority patterns:"));
      for (const pattern of config.notification.priorityPatterns) {
        console.log(`  - ${pattern}`);
      }

      const action = await Select.prompt({
        message: "Action",
        options: [
          { name: "Add priority pattern", value: "add" },
          { name: "Remove priority pattern", value: "remove" },
        ],
      });

      if (action === "add") {
        const newPattern = await Input.prompt({
          message: "Enter priority pattern",
        });

        if (!config.notification.priorityPatterns.includes(newPattern)) {
          config.notification.priorityPatterns.push(newPattern);
          console.log(colors.green(`Added ${newPattern} to priority patterns`));
        } else {
          console.log(
            colors.yellow(`${newPattern} is already in priority patterns`),
          );
        }
      } else if (action === "remove") {
        const patternToRemove = await Select.prompt({
          message: "Select pattern to remove",
          options: config.notification.priorityPatterns,
        });

        config.notification.priorityPatterns = config.notification
          .priorityPatterns.filter(
            (pattern: string) => pattern !== patternToRemove,
          );
        console.log(
          colors.green(`Removed ${patternToRemove} from priority patterns`),
        );
      }
    }
  } else if (section === "insights") {
    console.log(colors.green("Insights settings:"));
    console.log(
      `  Collect stats: ${
        config.insights.collectStats ? "Enabled" : "Disabled"
      }`,
    );
    console.log(
      `  Daily summary: ${
        config.insights.dailySummary ? "Enabled" : "Disabled"
      }`,
    );

    const collectStats = await Select.prompt({
      message: "Collect development statistics?",
      options: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: config.insights.collectStats,
    });

    const dailySummary = await Select.prompt({
      message: "Generate daily summary?",
      options: [
        { name: "Yes", value: true },
        { name: "No", value: false },
      ],
      default: config.insights.dailySummary,
    });

    config.insights.collectStats = collectStats;
    config.insights.dailySummary = dailySummary;
    console.log(colors.green("Insights settings updated"));
  }

  // Save updated config
  await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(colors.green("Configuration saved successfully"));
}

// Main menu function
async function showMainMenu(broker: EventBroker): Promise<void> {
  while (true) {
    console.log(colors.blue("\n📊 DevStream - Developer Productivity Stream"));

    const action = await Select.prompt({
      message: "Select an action",
      options: [
        { name: "🔍 View Recent Events", value: "events" },
        { name: "📋 List Topics & Subscriptions", value: "topics" },
        { name: "⚠️ Manage Dead Letter Queue", value: "dlq" },
        { name: "🧠 Toggle Focus Mode", value: "focus" },
        { name: "🤖 Create Automation", value: "automation" },
        { name: "📊 Generate Insights Report", value: "insights" },
        { name: "⚙️ Configure Settings", value: "configure" },
        { name: "❌ Exit", value: "exit" },
      ],
    });

    if (action === "exit") {
      break;
    } else if (action === "events") {
      await commandViewEvents(broker, {});
    } else if (action === "topics") {
      await commandListTopics(broker);
    } else if (action === "dlq") {
      await commandManageDLQ(broker);
    } else if (action === "focus") {
      await commandToggleFocus(broker);
    } else if (action === "automation") {
      await commandCreateAutomation(broker);
    } else if (action === "insights") {
      await commandGenerateInsights(broker);
    } else if (action === "configure") {
      await commandConfigure();
    }
  }
}

// Main function
async function main(): Promise<void> {
  const args = parse(Deno.args, {
    string: ["topic", "limit"],
    default: {
      topic: "",
      limit: "10",
    },
    boolean: ["help", "version", "interactive"],
    alias: {
      h: "help",
      v: "version",
      i: "interactive",
      t: "topic",
      l: "limit",
    },
  });

  // Show help
  if (args.help) {
    console.log(`
DevStream - Developer Productivity Stream

USAGE:
  devstream [OPTIONS] [COMMAND]

OPTIONS:
  -h, --help                Show this help message
  -v, --version             Show version information
  -i, --interactive         Start in interactive mode

COMMANDS:
  watch                     Start watching development activity
  events [--topic=<topic>]  View recent events (optionally filter by topic)
  topics                    List all topics and subscriptions
  dlq                       Manage dead letter queue
  focus                     Toggle focus mode
  automation                Create a new automation
  insights                  Generate development insights report
  configure                 Configure DevStream settings
    `);
    Deno.exit(0);
  }

  // Show version
  if (args.version) {
    const configText = await Deno.readTextFile(CONFIG_FILE);
    const config = JSON.parse(configText);
    console.log(`DevStream v${config.version}`);
    Deno.exit(0);
  }

  // Initialize broker
  const broker = await initBroker();

  // Load config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  // Process commands
  const command = args._[0]?.toString() ||
    (args.interactive ? "interactive" : null);

  if (!command) {
    console.log(
      "No command specified. Use --help for usage information or --interactive for interactive mode.",
    );
    Deno.exit(1);
  }

  if (command === "watch" || command === "interactive") {
    console.log(colors.green("📊 Starting DevStream..."));

    // Start watching files
    const watchDirs = (config.watchDirs || []).map((dir: string) =>
      path.join(Deno.cwd(), dir)
    );
    if (watchDirs.length === 0) {
      console.error(colors.red("No watch directories specified"));
      Deno.exit(1);
    }

    await watchFiles(broker, watchDirs, config.ignorePaths);

    // Start watching git
    await watchGit(broker);

    // Start watching builds
    await watchBuilds(broker);

    // Setup notifications
    await setupNotifications(broker);

    // Setup automations
    await setupAutomations(broker);

    // Setup insights
    await setupInsights(broker);

    console.log(
      colors.green("✅ DevStream is now monitoring your development activity"),
    );

    // Show interactive menu if requested
    if (command === "interactive" || args.interactive) {
      await showMainMenu(broker);
      Deno.exit(0);
    }
  } else if (command === "events") {
    await commandViewEvents(broker, { topic: args.topic, limit: args.limit });
  } else if (command === "topics") {
    await commandListTopics(broker);
  } else if (command === "dlq") {
    await commandManageDLQ(broker);
  } else if (command === "focus") {
    await commandToggleFocus(broker);
  } else if (command === "automation") {
    await commandCreateAutomation(broker);
  } else if (command === "insights") {
    await commandGenerateInsights(broker);
  } else if (command === "configure") {
    await commandConfigure();
  } else {
    console.error(colors.red(`Unknown command: ${command}`));
    console.log("Use --help for usage information.");
    Deno.exit(1);
  }
}

// Start the application
if (import.meta.main) {
  main().catch((error) => {
    console.error(colors.red("Fatal error:"), error);
    Deno.exit(1);
  });
}
