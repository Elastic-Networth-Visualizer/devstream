export interface FileChangeEvent {
  path: string;
  operation: "create" | "modify" | "delete";
  extension: string;
  size?: string;
}

export interface GitEvent {
  operation: "commit" | "push" | "pull" | "merge" | "branch" | "checkout";
  message?: string;
  branch?: string;
  hash?: string;
}

export interface BuildEvent {
  operation: "start" | "success" | "failure";
  buildFile?: string;
  language?: string;
  duration?: number;
  errors?: string[];
  warnings?: string[];
}

export interface NotificationEvent {
  level: "info" | "warning" | "error" | "success";
  message: string;
  source: string;
  actionable: boolean;
  actions?: string[];
}

export interface FocusStateEvent {
  state: "focus" | "break" | "available";
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface WorkflowEvent {
  name: string;
  trigger: string;
  action: string;
  status: "started" | "completed" | "failed";
  error?: string;
}
