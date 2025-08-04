# Project Coding Standards

## Core Principles
1. **Write modular, clean code** - Every function should have a single responsibility
2. **Always write unit tests** - Test coverage is mandatory for new features
3. **Refactor as you go** - Don't accumulate technical debt
4. **No garbage code** - Every line should have a purpose

## Code Structure Requirements
- **Modular Architecture**: Separate concerns into distinct modules/files
- **Small Functions**: Keep functions under 20 lines when possible
- **Clear Naming**: Use descriptive variable and function names
- **DRY Principle**: Don't Repeat Yourself - extract common functionality

## Testing Requirements
- Write unit tests for all new functions
- Test edge cases and error conditions
- Aim for >80% code coverage
- Run tests before marking any task as complete

## Chrome Extension Specific
- Keep background scripts minimal and efficient
- Content scripts should be isolated and non-invasive
- Use message passing for communication between components
- Follow Chrome Extension Manifest V3 best practices

## Before Completing Any Task
1. Ensure code is modular and follows single responsibility principle
2. Write/update unit tests
3. Run linting and type checking (if available)
4. Refactor any code smells
5. Verify the solution works end-to-end
6. **IMPORTANT**: Run `git commit` at good milestones to track progress

## Git Commit Strategy
- **Automatically commit at good milestones** without asking
- Good milestones include:
  - Completing a major feature or component
  - Fixing significant bugs or issues
  - Refactoring or architectural improvements
  - Adding comprehensive tests
  - Completing user-requested tasks
- Use descriptive commit messages that explain the "why" not just the "what"
- Always include co-authored attribution with Claude Code
- Push to remote only when explicitly requested

## File Organization
- `/src` - Source code
- `/tests` - Unit tests
- `/utils` - Shared utilities
- Keep related functionality grouped together