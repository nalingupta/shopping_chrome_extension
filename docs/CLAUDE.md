# Project Coding Standards

## Core Principles
1. **Write modular, clean code** - Every function should have a single responsibility
2. **Maintain clean codebase** - No console debugging statements in production code
3. **Refactor as you go** - Don't accumulate technical debt
4. **No garbage code** - Every line should have a purpose
5. **Focus on debugger capture** - Use Chrome debugger API for browser-only capture without OS prompts

## Code Structure Requirements
- **Modular Architecture**: Separate concerns into distinct modules/files
- **Small Functions**: Keep functions under 20 lines when possible
- **Clear Naming**: Use descriptive variable and function names
- **DRY Principle**: Don't Repeat Yourself - extract common functionality

## Development Requirements
- Remove debugging console statements from production code
- Test functionality manually in Chrome extension environment
- Ensure tab capture works properly with sidepanel
- Verify voice input integrates correctly with screen recording

## Chrome Extension Specific
- Keep background scripts minimal and efficient
- Content scripts should be isolated and non-invasive
- Use message passing for communication between components
- Follow Chrome Extension Manifest V3 best practices

## Before Completing Any Task
1. Ensure code is modular and follows single responsibility principle
2. Remove any debugging console statements
3. Test in actual Chrome extension environment
4. Refactor any code smells
5. Verify tab capture and sidepanel functionality
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
- `/src/background/` - Background service worker
- `/src/content/` - Content scripts
- `/src/services/` - Core business logic (voice, screen recording, AI assistant)
- `/src/sidepanel/` - Sidepanel UI logic
- `/src/utils/` - Shared utilities
- `/docs/` - Technical documentation
- Keep related functionality grouped together