#!/usr/bin/env -S deno run --watch --allow-read --allow-write --allow-net --allow-env --allow-run
import * as path from "@std/path";
import { parseArgs } from "@std/cli/parse-args";
import { colors } from "@cliffy/ansi/colors";
import { Select } from "@cliffy/prompt";
import type { EventBroker } from "@env/env-event-stream";
import { initBroker } from "./helpers/index.ts";
import { CONFIG_FILE } from "./config/constants.ts";
import { watchBuilds, watchFiles, watchGit } from "./config/watchers.ts";
import {
  commandConfigure,
  commandCreateAutomation,
  commandGenerateInsights,
  commandListTopics,
  commandManageDLQ,
  commandToggleFocus,
  commandViewEvents,
} from "./commands/index.ts";
import {
  setupAutomations,
  setupInsights,
  setupNotifications,
} from "./config/setup.ts";

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
  const args = parseArgs(Deno.args, {
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

    // Start watching stuff
    await watchFiles(broker, watchDirs, config.ignorePaths);
    await watchGit(broker);
    watchBuilds(broker);

    // Setup stuff
    await setupNotifications(broker);
    await setupAutomations(broker);
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
