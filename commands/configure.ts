import { colors } from "@cliffy/ansi/colors";
import { CONFIG_FILE } from "../config/constants.ts";
import { Input, Select } from "@cliffy/prompt";

export async function commandConfigure(): Promise<void> {
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
