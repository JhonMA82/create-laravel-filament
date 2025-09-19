# Release Management

A comprehensive Claude Code command for managing the automated release workflow.

## Usage

```bash
/release [action] [options]
```

## Actions

### `status`
Shows the current release status and configuration.

**Options:**
- `--verbose`: Show detailed information

### `commit [type] [message]`
Creates a conventional commit with the specified type and message.

**🤖 Smart Mode (NEW!):**
When used without arguments, it automatically analyzes your changes and suggests:
- The most appropriate commit type based on file changes
- Suggested version bump (minor/patch)
- Interactive confirmation

**Manual Mode:**
**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Maintenance tasks
- `ci`: CI configuration changes

**Examples:**
```bash
# Smart mode - automatic analysis
/release commit

# Manual mode
/release commit feat "Add new authentication system"
```

### `release [version]`
Manually triggers a release (bypassing release-please).

**🤖 Smart Mode (NEW!):**
When used without arguments, it automatically:
- Analyzes unstaged changes and suggests version type
- Shows unreleased commits and their impact
- Recommends minor/patch based on commit types
- Interactive confirmation process

**Manual Mode:**
**Options:**
- `--major`: Major version bump
- `--minor`: Minor version bump
- `--patch`: Patch version bump
- `--prerelease`: Mark as prerelease

**Examples:**
```bash
# Smart mode - automatic analysis
/release release

# Manual mode
/release release --minor
```

### `configure`
Shows current configuration and helps with setup.

### `verify`
Verifies that all release components are properly configured.

### `help`
Shows this help information.

## Features

### 🤖 Intelligent Analysis
- **Smart Commit Detection**: Automatically analyzes file changes to suggest the best commit type
- **Version Recommendation**: Suggests minor/patch versions based on the nature of changes
- **Commit Categorization**: Categorizes files by type (docs, tests, code, config, etc.)
- **Interactive Confirmation**: Guides you through the process with intelligent suggestions

### 🔄 Automated Version Management
- **Semantic Versioning**: Uses release-please for proper version management
- **Conventional Commits**: Validates commit messages following conventional commits specification
- **Smart Release Suggestions**: Analyzes commit history to recommend version bumps
- **Unreleased Commits Analysis**: Shows commits since last release and their impact

### 🚀 CI/CD Integration
- **GitHub Actions**: Automated CI/CD pipeline
- **npm Publishing**: Automatic publishing to npm registry
- **Pre-commit Hooks**: Ensures code quality before commits
- **Release Notes**: Automatic generation of release notes

## Configuration Files

The following files are configured by the setup script:

- `.github/release-please-config.json`: Release-please configuration
- `.github/.release-please-manifest.json`: Version tracking
- `.github/workflows/release-please.yml`: Release PR creation workflow
- `.github/workflows/publish-npm.yml`: npm publishing workflow
- `.husky/commit-msg`: Commit message validation
- `.husky/pre-commit`: Pre-commit checks
- `commitlint.config.js`: Commit message validation rules

## Requirements

- GitHub repository with appropriate permissions
- NPM_TOKEN secret configured in GitHub Actions
- Node.js >= 16.0.0
- pnpm package manager

## Examples

```bash
# Check release status
/release status --verbose

# Smart commit - automatic analysis
/release commit

# Manual commits
/release commit feat "Add user profile page"
/release commit fix "Resolve login issue on mobile"

# Smart release - automatic version suggestion
/release release

# Manual releases
/release release --minor
/release release --patch --prerelease

# Verify configuration
/release verify

# Show unreleased commits analysis
/release release
```

## Troubleshooting

If you encounter issues:

1. **Commit message validation fails**: Ensure your commit message follows conventional commits format
2. **Release PR not created**: Check GitHub Actions permissions and repository settings
3. **npm publishing fails**: Verify NPM_TOKEN is correctly configured in GitHub secrets
4. **Pre-commit hooks fail**: Run checks manually to identify issues

## Workflow

1. Make commits using conventional commits format
2. Push to main branch
3. Release-please creates a Release PR
4. Merge the Release PR
5. GitHub Actions publishes to npm automatically

For more information, see: [Conventional Commits](https://www.conventionalcommits.org/)