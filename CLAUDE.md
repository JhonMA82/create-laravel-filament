# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a CLI tool for creating Laravel + Filament projects with automated setup. The tool scaffolds complete Laravel projects with Filament admin panel, starter kits (React/Vue/Livewire), database configuration, and development tools.

## Common Commands

### Development
```bash
# Run the CLI locally
node index.js

# Install dependencies
npm install

# Install globally for testing
npm link
create-laravel-filament
```

### Testing Modes
```bash
# Interactive mode (default)
node index.js

# Non-interactive mode with flags
node index.js create --non-interactive --project-name app --starter-kit react --db sqlite -y

# JSON output for CI/automation
node index.js create --json --non-interactive --project-name app --starter-kit react --db sqlite
```

## Architecture

### Core Components
- **Entry Point**: `index.js` - Binary bootstrap with error handling
- **CLI Framework**: `src/cli/program.js` - Commander.js setup with flags and commands
- **Main Command**: `src/commands/create.js` - Interactive prompts and task orchestration

### Key Libraries
- **Commander**: CLI parsing and command structure
- **Clack**: Interactive prompts with TTY detection
- **Listr2**: Task pipeline with progress feedback
- **execa**: Process execution for external commands
- **chalk**: Colored output with TTY awareness

### Execution Flow
1. `index.js` → `runCli()` → Commander parsing
2. `buildProgram()` sets up flags and `create` command
3. `runCreate()` handles context and mode detection
4. Either `interactiveGather()` for prompts or direct flag usage
5. Listr2 pipeline executes 12 sequential tasks

### Task Pipeline
The CLI executes a fixed sequence of tasks:
1. Prechecks (verify `herd` command, working directory)
2. Laravel scaffold (`laravel new`)
3. Database setup (SQLite/Supabase/MySQL/PostgreSQL)
4. Filament installation and configuration
5. Testing setup (Pest)
6. Development tools (Laravel Boost, Larastan, Debugbar)
7. Code quality tools (Pint, Rector)
8. Essentials (VCS, vendor publishing)
9. Frontend build (npm install, Vite setup)
10. Spanish localization
11. Pre-commit checks (phpstan, pest, pint, rector)
12. Initial git commit

## Important Patterns

### Context Handling
- Context object includes flags, environment info (TTY, Node version, platform)
- Color output controlled by `--json`, `--no-color`, `--color`, and TTY detection
- Interactive mode requires TTY and no `--non-interactive` or `--json` flags

### Error Handling
- Try-catch blocks around external command execution
- Graceful exit with appropriate error codes
- Error output respects color and JSON modes

### File Structure
```
src/
├── cli/
│   └── program.js          # Commander setup and parsing
├── commands/
│   └── create.js           # Main create command logic
└── legacy/                 # Legacy code (currently empty)
```

## Database Support

### SQLite
- Creates `database.sqlite` file
- Sets up `.env` with SQLite configuration

### Supabase
- Requires Docker Desktop running
- Installs Supabase CLI via npm
- Runs `supabase init` and `supabase start`

### MySQL/PostgreSQL
- Validates connection via port checking
- Requires host, port, database name, user, password
- Updates `.env` with provided credentials

## Development Notes

### Adding New Tasks
- Tasks are added to the Listr2 pipeline in `src/commands/create.js`
- Maintain the sequential order for dependencies
- Update JSON output structure if task changes affect output

### Flag Management
- Global flags: `--json`, `--color/--no-color`, `-y/--yes`, `--non-interactive`, `--verbose`
- Command-specific flags: project name, starter kit, database options, Filament credentials
- Use Commander's `Option` for choice validation (starter kit, database types)

### Testing Changes
- Test all three modes: interactive, non-interactive, and `--json`
- Verify help output reflects changes
- Check color output behavior in different scenarios