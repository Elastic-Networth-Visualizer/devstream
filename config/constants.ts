import { join } from "@std/path";
import type { Config } from "../types/index.ts";

export const HOME_DIR = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") ||
  Deno.cwd();
export const CONFIG_DIR = join(HOME_DIR, ".devstream");
export const EVENT_STORE_DIR = join(CONFIG_DIR, "events");
export const DLQ_DIR = join(CONFIG_DIR, "dlq");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_CONFIG: Config = {
  version: "0.1.0",
  watchDirs: ["./src", "./tests", "./docs"],
  ignorePaths: ["node_modules", "dist", ".git", "target", "build"],
  topics: {
    "file.changes": {
      persistent: true,
      retentionPeriod: 7 * 24 * 60 * 60 * 1000,
    }, // 7 days
    "git.events": {
      persistent: true,
      retentionPeriod: 30 * 24 * 60 * 60 * 1000,
    }, // 30 days
    "build.events": {
      persistent: true,
      retentionPeriod: 3 * 24 * 60 * 60 * 1000,
    }, // 3 days
    "notification": { persistent: false },
    "focus.state": { persistent: true },
    "workflow.automation": { persistent: true },
  },
  automations: [],
  notification: {
    focusMode: false,
    silentHours: { start: "22:00", end: "08:00" },
    priorityPatterns: ["test failure", "build failure", "security", "deadline"],
  },
  insights: {
    collectStats: true,
    dailySummary: true,
  },
};
