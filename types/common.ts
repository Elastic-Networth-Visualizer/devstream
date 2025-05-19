export interface OptimizedBuildConfig {
  lookup: Map<string, boolean>;
  patterns: Array<[RegExp, string]>;
}

export interface AutomationConfig {
  name: string;
  trigger: {
    eventType?: string;
    topic: string;
    condition?: string;
  };
  action: {
    type: string;
    command: string;
    args?: string[];
  }
}

export interface Config {
  version: string;
  watchDirs: string[];
  ignorePaths: string[];
  topics: {
    [topic: string]: {
      persistent: boolean;
      retentionPeriod?: number; // in milliseconds
    };
  };
  automations: AutomationConfig[];
  notification: {
    focusMode: boolean;
    silentHours: {
      start: string; // "HH:mm"
      end: string; // "HH:mm"
    };
    priorityPatterns: string[];
  };
  insights: {
    collectStats: boolean;
    dailySummary: boolean;
  };
}
