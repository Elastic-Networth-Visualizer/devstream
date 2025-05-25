import type { EventBroker } from "@env/env-event-stream";
import { colors } from "@cliffy/ansi/colors";

export function commandListTopics(broker: EventBroker): void {
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
