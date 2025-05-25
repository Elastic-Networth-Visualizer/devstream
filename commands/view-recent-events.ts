// deno-lint-ignore-file no-explicit-any
import { Select } from "@cliffy/prompt";
import type { EventBroker } from "@env/env-event-stream";
import { colors } from "@cliffy/ansi/colors";
import { Table } from "@cliffy/table";

export async function commandViewEvents(
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
  const table = new Table().border(true).padding(1);
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
