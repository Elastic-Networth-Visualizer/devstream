import { EventBroker, FileDeadLetterQueue, FileEventStore } from "@env/env-event-stream";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_CONFIG, DLQ_DIR, EVENT_STORE_DIR } from "../constants.ts";

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
