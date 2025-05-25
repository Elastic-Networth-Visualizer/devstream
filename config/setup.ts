// deno-lint-ignore-file no-explicit-any
import type { EventBroker } from "@env/env-event-stream";
import { CONFIG_FILE } from "./constants.ts";
import type {
  AutomationConfig,
  FileChangeEvent,
  FocusStateEvent,
  GitEvent,
  NotificationEvent,
  WorkflowEvent,
} from "../types/index.ts";
import {
  generateDailySummary,
  getBuiltinNotifierCommandAndArgs,
  isHighPriority,
  isInSilentHours,
} from "../helpers/index.ts";
import { colors } from "@cliffy/ansi/colors";

export async function setupNotifications(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("notification")) broker.createTopic("notification");
  if (!broker.getTopic("focus.state")) broker.createTopic("focus.state");

  // Get config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const config = JSON.parse(configText);

  // Track focus state
  let inFocusMode = config.notification.focusMode;

  // Subscribe to notification events
  broker.subscribe("notification", async (event) => {
    const notificationEvent = event.payload as NotificationEvent;

    // Skip non-priority notifications during focus mode and silent hours
    if (
      !isHighPriority(notificationEvent.message, config) && (
        inFocusMode || isInSilentHours(config)
      )
    ) {
      console.debug(
        `Suppressing notification during focus mode: ${notificationEvent.message}`,
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

    // Use the built-in notification system based on OS
    const { cmd, args } = getBuiltinNotifierCommandAndArgs({
      message: notificationEvent.message,
      source: notificationEvent.source,
    });

    // Run the command to show notification
    const command = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    await command.output();
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

export async function setupAutomations(broker: EventBroker): Promise<void> {
  if (!broker.getTopic("workflow.automation")) {
    broker.createTopic("workflow.automation");
  }

  // Read automations from config
  const configText = await Deno.readTextFile(CONFIG_FILE);
  const { automations } = JSON.parse(configText) as {
    automations: AutomationConfig[];
  };

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

export async function setupInsights(broker: EventBroker): Promise<void> {
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
