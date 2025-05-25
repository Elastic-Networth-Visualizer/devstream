import type { EventBroker } from "@env/env-event-stream";
import { CONFIG_FILE } from "../config/constants.ts";
import { Input } from "@cliffy/prompt";
import type { FocusStateEvent, NotificationEvent } from "../types/index.ts";
import { colors } from "@cliffy/ansi/colors";

export async function commandToggleFocus(broker: EventBroker): Promise<void> {
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
