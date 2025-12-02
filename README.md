# Franco

Not ready for use still! Just displaying :)
Make an issue requesting for publishing!

---

A type-safe, command-pattern-based state machine implementation for TypeScript with built-in undo/redo support.

## Features

- **Type-safe**: Full TypeScript support with strict type checking for states, messages, and transitions
- **Command Pattern**: Each state transition is a command that can be executed and undone
- **Undo/Redo**: Built-in history management with undo/redo functionality
- **Flexible Configuration**: Define allowed transitions per state with a simple configuration object
- **Model Integration**: Seamlessly integrate with your application's model/state

## Core Concepts

### States

States represent the different conditions your application can be in. Each state must have an `id` property and can optionally contain additional data.

```typescript
type MyStates = {
  idle: void;
  active: { startTime: number };
  disabled: { reason: string };
};
```

### Messages

Messages are events that trigger state transitions. Like states, they must have an `id` property and can contain payload data. The state machine automatically includes `undo` and `redo` messages.

```typescript
type MyMessages = {
  activate: { timestamp: number };
  deactivate: void;
  disable: { reason: string };
  enable: void;
  // undo and redo are automatically included
};
```

### Configuration

The configuration defines which messages are allowed in each state and which states they can transition to.

```typescript
const config = {
  idle: {
    on: {
      activate: ["active", "idle"], // Can transition to 'active' or stay in 'idle'
      disable: ["disabled"],
    },
  },
  active: {
    on: {
      deactivate: ["idle"],
      disable: ["disabled"],
      increment: ["active"], // Can stay in 'active'
    },
    disableUndoRedo: true, // Optional: disable undo/redo for this state
  },
  disabled: {
    on: {
      enable: ["idle"],
    },
  },
};
```

### Commands

Commands are factories that create command objects with `execute()` and optional `undo()` methods. They receive the current model, state, and message as parameters.

```typescript
const commands = {
  idle: {
    activate: ({ message }) => ({
      execute: () => ({
        id: "active",
        startTime: message.timestamp,
      }),
    }),
  },
  active: {
    increment: ({ model, state }) => {
      const prevValue = model.value;
      return {
        execute: () => {
          model.increment();
          return {
            id: "active",
            ...state,
          };
        },
        undo: () => {
          model.setValue(prevValue);
        },
      };
    },
  },
};
```

## Usage

### Basic Example

```typescript
import { StateMachine, types } from "./state-machine";

// Define your types
type CounterModel = {
  value: number;
  increment: () => void;
  decrement: () => void;
  setValue: (value: number) => void;
};

type States = {
  idle: void;
  active: { startTime: number };
};

type Messages = {
  activate: { timestamp: number };
  deactivate: void;
  increment: void;
  decrement: void;
};

// Create your model
function createModel(): CounterModel {
  let value = 0;
  return {
    get value() {
      return value;
    },
    increment() {
      value++;
    },
    decrement() {
      value--;
    },
    setValue(newValue: number) {
      value = newValue;
    },
  };
}

// Create the state machine
const model = createModel();
const machine = new StateMachine({
  types: types<States, Messages>(),
  model,
  initialState: { id: "idle" },
  config: {
    idle: {
      on: {
        activate: ["active"],
      },
    },
    active: {
      on: {
        deactivate: ["idle"],
        increment: ["active"],
        decrement: ["active"],
      },
    },
  },
  commands: {
    idle: {
      activate: ({ message }) => ({
        execute: () => ({
          id: "active",
          startTime: message.timestamp,
        }),
      }),
    },
    active: {
      deactivate: () => ({
        execute: () => ({ id: "idle" }),
      }),
      increment: ({ model, state }) => {
        const prevValue = model.value;
        return {
          execute: () => {
            model.increment();
            return { id: "active", ...state };
          },
          undo: () => model.setValue(prevValue),
        };
      },
      decrement: ({ model, state }) => {
        const prevValue = model.value;
        return {
          execute: () => {
            model.decrement();
            return { id: "active", ...state };
          },
          undo: () => model.setValue(prevValue),
        };
      },
    },
  },
});

// Use the state machine
machine.execute({ id: "activate", timestamp: Date.now() });
console.log(machine.state); // { id: 'active', startTime: ... }

machine.execute({ id: "increment" });
console.log(model.value); // 1

machine.execute({ id: "undo" });
console.log(model.value); // 0
```

## API Reference

### `types<TStates, TMessages>()`

A utility function that helps TypeScript infer the state and message types when creating a state machine instance.

**Parameters:**

- `TStates`: A record type mapping state names to their data types (or `void`)
- `TMessages`: A record type mapping message names to their payload types (or `void`)

**Returns:** An empty object used for type inference

### `StateMachine`

The main state machine class.

#### Constructor

```typescript
new StateMachine({
  types: Types<TStates, TMessages>,
  model: TModel,
  config: Config<TStates, TMessages>,
  commands: Commands<TModel, TStates, TMessages, TConfig>,
  initialState: AnyState<TStates>,
});
```

**Parameters:**

- `types`: Type information created with `types<TStates, TMessages>()`
- `model`: Your application's model object
- `config`: State transition configuration
- `commands`: Command factories for each state/message combination
- `initialState`: The initial state of the machine

#### Methods

##### `execute(message: AnyMessage<TMessages>)`

Executes a message, triggering a state transition if the message is valid for the current state.

**Parameters:**

- `message`: A message object with an `id` property and optional payload

**Returns:** `void`

**Special Messages:**

- `{ id: 'undo' }`: Undoes the last executed command
- `{ id: 'redo' }`: Redoes the last undone command

##### `getCurrentState(): AnyState<TStates>`

Returns the current state of the machine.

**Returns:** The current state object

#### Properties

##### `state: AnyState<TStates>`

Getter that returns the current state (same as `getCurrentState()`).

##### `model: TModel`

Getter that returns the model object passed to the constructor.

## Type Safety

The state machine provides strong type safety:

- **State Transitions**: TypeScript will error if you try to transition to a state not defined in the configuration
- **Message Validation**: Only messages defined in the configuration for the current state can be executed
- **Command Factories**: Command factories receive correctly typed `model`, `state`, and `message` parameters
- **Return Types**: Commands must return states that match the allowed transitions

## Undo/Redo

The state machine automatically supports undo/redo functionality:

- **Undo**: Call `machine.execute({ id: 'undo' })` to undo the last command
- **Redo**: Call `machine.execute({ id: 'redo' })` to redo the last undone command
- **Disable**: Set `disableUndoRedo: true` in a state's configuration to disable undo/redo for that state
- **History**: The machine maintains separate history and future stacks for undo/redo operations
- **Clear Future**: Executing a new command after undoing clears the redo history

### Undo/Redo Requirements

For undo/redo to work properly, your commands should implement the `undo()` method:

```typescript
{
  execute: () => {
    // Perform the action
    return newState;
  },
  undo: () => {
    // Reverse the action
  }
}
```

## Examples

See `state-machine.test.ts` for comprehensive examples including:

- Basic state transitions
- Model integration
- Undo/redo operations
- Complex workflows
- Multiple independent state machines

## Type Exports

The module exports the following types for use in your code:

- `AnyState<TStates>`: A union type of all possible states
- `AnyMessage<TMessages>`: A union type of all possible messages (including `undo` and `redo`)
