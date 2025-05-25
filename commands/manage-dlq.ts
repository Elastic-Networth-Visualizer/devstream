import { colors } from "@cliffy/ansi/colors";
import type { EventBroker } from "@env/env-event-stream";
import { Table } from "@cliffy/table";
import { Select } from "@cliffy/prompt";

export async function commandManageDLQ(broker: EventBroker): Promise<void> {
  const deadLetterQueue = broker.getDeadLetterQueue();
  const entries = await deadLetterQueue.getEvents();

  console.log(colors.blue(`📋 Dead Letter Queue Events (${entries.length}):`));

  if (entries.length === 0) {
    console.log(colors.green("No failed events in the queue"));
    return;
  }

  // Create a table to display DLQ entries
  const table = new Table().border(true).padding(1);
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
