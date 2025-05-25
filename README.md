# DevStream - Developer Productivity Stream

A command-line utility that monitors development activities and provides insights into your coding workflow. DevStream tracks file changes, Git operations, build processes, and focus sessions to help developers understand and optimize their productivity patterns.

## Features

- **Real-time File Monitoring**: Track file changes across your project directories
- **Git Integration**: Monitor Git operations (commits, pushes, pulls, branch changes)
- **Build System Awareness**: Detect and track build file changes across multiple languages
- **Focus Mode**: Time-boxed focus sessions with notification management
- **Smart Notifications**: Context-aware notifications with priority filtering
- **Automation System**: Create custom automations triggered by development events
- **Insights & Analytics**: Generate detailed reports on development patterns
- **Event-driven Architecture**: Built on a robust event streaming system

## Installation

### Prerequisites
- [Deno](https://deno.land/) (LTS version recommended)

### Build from Source
```bash
git clone https://github.com/Elastic-Networth-Visualizer/devstream.git
cd devstream

# Build for your platform
deno task build:linux    # Linux
deno task build:macos    # macOS  
deno task build:windows  # Windows
```

### Development
```bash
# Run in development mode with file watching
deno task dev

# Or run directly
deno run --allow-read --allow-write --allow-net --allow-env --allow-run main.ts
```

## Quick Start

1. **Initial Setup**: DevStream will create a configuration directory at `~/.devstream/` on first run.

2. **Start Monitoring**:
   ```bash
   ./devstream watch
   ```

3. **Interactive Mode**:
   ```bash
   ./devstream --interactive
   ```

4. **Configure Watch Directories**:
   ```bash
   ./devstream configure
   ```

## Usage

### Basic Commands

```bash
# Show help
devstream --help

# Show version
devstream --version

# Start monitoring (daemon mode)
devstream watch

# Interactive mode with menu
devstream --interactive

# View recent events
devstream events

# View events for specific topic
devstream events --topic=file.changes --limit=20

# List all topics and subscriptions
devstream topics

# Toggle focus mode
devstream focus

# Generate insights report
devstream insights

# Configure settings
devstream configure

# Manage failed events
devstream dlq

# Create automation
devstream automation
```

### Interactive Mode

The interactive mode provides a menu-driven interface:

- 🔍 **View Recent Events** - Browse event history by topic
- 📋 **List Topics & Subscriptions** - See active event streams
- ⚠️ **Manage Dead Letter Queue** - Handle failed events
- 🧠 **Toggle Focus Mode** - Start/stop focus sessions
- 🤖 **Create Automation** - Set up event-driven workflows
- 📊 **Generate Insights Report** - Analyze development patterns
- ⚙️ **Configure Settings** - Modify watch directories, notifications, etc.

## Configuration

DevStream uses a JSON configuration file located at `~/.devstream/config.json`.

### Default Configuration

```json
{
  "version": "0.1.0",
  "watchDirs": ["./src", "./tests", "./docs"],
  "ignorePaths": ["node_modules", "dist", ".git", "target", "build"],
  "topics": {
    "file.changes": {
      "persistent": true,
      "retentionPeriod": 604800000
    },
    "git.events": {
      "persistent": true,
      "retentionPeriod": 2592000000
    },
    "build.events": {
      "persistent": true,
      "retentionPeriod": 259200000
    },
    "notification": { "persistent": false },
    "focus.state": { "persistent": true },
    "workflow.automation": { "persistent": true }
  },
  "automations": [],
  "notification": {
    "focusMode": false,
    "silentHours": { "start": "22:00", "end": "08:00" },
    "priorityPatterns": ["test failure", "build failure", "security", "deadline"]
  },
  "insights": {
    "collectStats": true,
    "dailySummary": true
  }
}
```

### Configuration Options

- **`watchDirs`**: Directories to monitor for file changes
- **`ignorePaths`**: Patterns to ignore (supports glob patterns)
- **`topics`**: Event topic configuration with persistence and retention settings
- **`automations`**: Custom automation rules
- **`notification`**: Notification settings including focus mode and silent hours
- **`insights`**: Analytics and reporting settings

## Event System

DevStream is built around an event-driven architecture with these main topics:

### Core Topics

- **`file.changes`**: File system events (create, modify, delete)
- **`git.events`**: Git operations (commit, push, pull, merge, branch, checkout)
- **`build.events`**: Build system events (start, success, failure)
- **`notification`**: System notifications
- **`focus.state`**: Focus mode state changes
- **`workflow.automation`**: Automation execution events

### Event Types

#### File Change Events
```typescript
{
  path: string;
  operation: "create" | "modify" | "delete";
  extension: string;
  size?: string;
}
```

#### Git Events
```typescript
{
  operation: "commit" | "push" | "pull" | "merge" | "branch" | "checkout";
  message?: string;
  branch?: string;
  hash?: string;
}
```

#### Build Events
```typescript
{
  operation: "start" | "success" | "failure";
  buildFile?: string;
  language?: string;
  duration?: number;
  errors?: string[];
  warnings?: string[];
}
```

## Supported Build Systems

DevStream automatically detects build files for various languages and frameworks:

- **JavaScript/Node.js**: `package.json`, `package-lock.json`, `yarn.lock`, `bun.lockb`
- **TypeScript**: `tsconfig.json`, `tsconfig.build.json`
- **Deno**: `deno.json`, `deno.jsonc`, `deps.ts`, `import_map.json`
- **Rust**: `Cargo.toml`, `Cargo.lock`
- **Go**: `go.mod`, `go.sum`, `Gopkg.toml`
- **Python**: `setup.py`, `pyproject.toml`, `requirements.txt`, `Pipfile`, `poetry.lock`
- **Java**: `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `build.xml`
- **Ruby**: `Gemfile`, `Gemfile.lock`, `Rakefile`
- **PHP**: `composer.json`, `composer.lock`
- **C++**: `CMakeLists.txt`, `Makefile`, `meson.build`, `SConstruct`
- **C#**: `*.csproj`, `*.sln`, `packages.config`
- **And many more...**

## Automations

Create custom automations that trigger on specific events:

### Example Automation

```json
{
  "name": "Run Tests on Test File Changes",
  "trigger": {
    "topic": "file.changes",
    "eventType": "file.modify",
    "condition": "/test/"
  },
  "action": {
    "type": "command",
    "command": "npm test"
  }
}
```

### Automation Components

- **Trigger**: Defines when the automation runs
  - `topic`: Event topic to listen to
  - `eventType`: Specific event type (optional)
  - `condition`: Text pattern to match in event payload (optional)
- **Action**: What to execute
  - `type`: Currently supports "command"
  - `command`: Shell command to execute

## Focus Mode

Focus mode helps manage distractions during coding sessions:

- **Timed Sessions**: Set focus duration (default: 25 minutes)
- **Notification Filtering**: Only priority notifications are shown
- **Automatic Completion**: Alerts when focus session ends
- **Statistics Tracking**: Records focus session data for insights

### Priority Patterns

Configure which notifications are considered high priority:
- "test failure"
- "build failure" 
- "security"
- "deadline"

## Insights & Analytics

Generate detailed reports on your development patterns:

### Metrics Tracked

- **File Activity**: Changes by extension, time of day, day of week
- **Focus Sessions**: Duration, frequency, effectiveness
- **Git Activity**: Commits, pushes, pulls frequency
- **Build Events**: Success/failure rates, languages used

### Report Generation

```bash
# Generate and display insights
devstream insights

# Reports are saved to ~/.devstream/reports/
```

## Error Handling

DevStream includes a Dead Letter Queue (DLQ) system for handling failed events:

- **Automatic Retry**: Failed events are automatically retried
- **Manual Management**: View and manage failed events via CLI
- **Debugging**: Detailed error information for troubleshooting

## Architecture

### Core Components

- **Event Broker**: Central event streaming system
- **File Watchers**: Monitor file system changes
- **Git Monitor**: Track Git repository changes  
- **Build Detector**: Identify build system events
- **Notification System**: OS-native notifications
- **Automation Engine**: Execute triggered workflows
- **Insights Collector**: Gather and analyze metrics

### Data Storage

- **Event Store**: Persistent event history
- **Configuration**: JSON-based settings
- **Reports**: Markdown-formatted insights

## Contributing

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Elastic-Networth-Visualizer/devstream.git
   cd devstream
   ```

2. **Install Deno**: Follow the [official installation guide](https://deno.land/manual/getting_started/installation)

3. **Run in development mode**:
   ```bash
   deno task dev
   ```

### Project Structure

```
devstream/
├── commands/           # CLI command implementations
├── config/            # Configuration and setup
├── helpers/           # Utility functions
├── types/             # TypeScript type definitions
├── .github/workflows/ # CI/CD configuration
├── main.ts           # Application entry point
└── mod.ts            # Module exports
```

### Code Style

- **Linting**: Uses Deno's built-in linter
- **Formatting**: 2-space indentation, 80-character line width
- **Type Safety**: Strict TypeScript configuration

### Testing

```bash
# Run tests
deno test

# Run with coverage
deno test --coverage
```

### Pull Request Guidelines

1. **Fork** the repository
2. **Create** a feature branch
3. **Write** tests for new functionality
4. **Ensure** all tests pass
5. **Follow** existing code style
6. **Submit** a pull request with clear description

### Adding New Features

1. **Events**: Define new event types in `types/events.ts`
2. **Commands**: Add CLI commands in `commands/` directory
3. **Watchers**: Extend monitoring in `config/watchers.ts`
4. **Automations**: Enhance automation system in `config/setup.ts`

## License

GPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/Elastic-Networth-Visualizer/devstream/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Elastic-Networth-Visualizer/devstream/discussions)
- **Email**: elasticnetworthvisualizer@gmail.com

## Acknowledgments

Built with [Deno](https://deno.land/) and powered by the [@env/env-event-stream](https://jsr.io/@env/env-event-stream) event system.
