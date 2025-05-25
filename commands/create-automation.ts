import { colors } from "@cliffy/ansi/colors";
import { CONFIG_FILE } from "../config/constants.ts";
import { setupAutomations } from "../config/setup.ts";
import { Input, Select } from "@cliffy/prompt";
import type { EventBroker } from "@env/env-event-stream";

export async function commandCreateAutomation(
  broker: EventBroker,
): Promise<void> {
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
