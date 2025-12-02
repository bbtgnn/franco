# ESLint Plugin: State Machine Union Return

Custom ESLint plugin that ensures StateMachine command implementations handle all declared target states.

## The Problem

When you configure a state transition with multiple target states:

```typescript
config: {
  idle: {
    on: {
      activate: ['active', 'idle'] // Can transition to either state
    }
  }
}
```

TypeScript's type system can't enforce that your implementation actually handles both states. This plugin catches that issue.

## Usage

The plugin exports both the rule and a complete ESLint configuration.

### In your `eslint.config.js`:

```javascript
import { eslintConfig as stateMachineConfig } from './src/lib/state-machine/eslint-plugin-state-machine/index.js';

export default defineConfig(
	// ... other configs
	stateMachineConfig
);
```

That's it! The exported config includes:

- File targeting (`**/*.ts`, `**/*.tsx`)
- Parser options (TypeScript with `projectService`)
- Plugin registration
- Rule configuration (error level)

### Customization

If you want to customize the configuration:

```javascript
import plugin from './src/lib/state-machine/eslint-plugin-state-machine/index.js';

export default defineConfig({
	files: ['**/*.ts'],
	plugins: { 'state-machine': plugin },
	rules: {
		'state-machine/state-machine-union-return': 'warn' // or 'error'
	}
});
```

## Example Error

```typescript
// ❌ Error: only returns 'active', but config declares ['active', 'idle']
activate: ({ message }) => ({
  execute: () => ({
    id: 'active',
    startTime: message.timestamp
  })
})
```

**Error message:**

> The "activate" message declares 2 possible target states [active, idle], but your implementation always returns "active". If only one state is possible, update the config to reflect this.

## How to Fix

### Option 1: Add conditional logic

```typescript
activate: ({ message }) => ({
  execute: () => {
    if (message.timestamp <= 0) {
      return { id: 'idle' }; // Handle error case
    }
    return { id: 'active', startTime: message.timestamp };
  }
})
```

### Option 2: Update config

If only one state is actually needed:

```typescript
config: {
  idle: {
    on: {
      activate: ['active'] // Single target state
    }
  }
}
```

## Architecture

The plugin uses AST analysis to:

1. Find `new StateMachine(...)` calls
2. Parse the `config` object to extract transitions
3. Analyze `commands` to find what states are returned
4. Report when only one state is returned but multiple are declared

## Files

- `index.js` - Plugin implementation and exported config
- `README.md` - This file

## Requirements

- `@typescript-eslint/utils` - For creating type-aware rules
- TypeScript project with `tsconfig.json` - For type information
- ESLint 9+ - For flat config support
