import type { Simplify } from 'type-fest';

// ========================================================================
// Utilities
// ========================================================================

// Base types (generic, can be used in any context)

type KeyOf<T extends Record<string, unknown>> = keyof T & string;

type ValueOf<T extends Record<string, unknown>> = T[keyof T];

type Tagged<T, TagName extends string, TagValue extends string> = Simplify<
	{ [x in TagName]: TagValue } & T
>;

// Business logic types (specific to the state machine logic)

type Repository = Record<string, object | void>;

type UndoRedoRepository = Repository & { undo: void; redo: void };

type TaggedRepository<TRepository extends Repository, TTag extends string> = {
	[K in KeyOf<TRepository>]: Tagged<TRepository[K], TTag, K>;
};

interface Command<T> {
	execute: () => T;
	undo?: () => void;
}

// Shorthand types (useful for readability)

type WithId<TRepository extends Repository> = TaggedRepository<TRepository, 'id'>;

export type AnyState<TStates extends Repository> = ValueOf<WithId<TStates>>;

export type AnyMessage<TMessages extends Repository> = ValueOf<WithId<TMessages>>;

// ========================================================================
// Configuration
// ========================================================================

type StateConfig<TStates extends Repository, TMessages extends Repository> = {
	on: {
		[MessageName in KeyOf<TMessages>]?: KeyOf<TStates>[];
	};
	disableUndoRedo?: true;
};

type Config<TStates extends Repository, TMessages extends Repository> = {
	[S in KeyOf<TStates>]: StateConfig<TStates, TMessages>;
};

// ========================================================================
// Commands
// ========================================================================

/**
 * (utility)  Extract the message keys from a state configuration.
 */
type StateConfigMessage<
	TStates extends Repository,
	TMessages extends Repository,
	TStateConfig extends StateConfig<TStates, TMessages>
> = KeyOf<TMessages> & KeyOf<TStateConfig['on']>;

/**
 * Utility to extract the target states from a message and a state configuration.
 */
type TargetStates<
	TStates extends Repository,
	TMessages extends Repository,
	TStateConfig extends StateConfig<TStates, TMessages>,
	TMessage extends StateConfigMessage<TStates, TMessages, TStateConfig>
> = Simplify<
	// prettier-ignore
	WithId<TStates>[
		// Take the union of all the state names resulting from the message
		NonNullable<TStateConfig['on'][TMessage]>[number]
		// and intersect with all the state names (improves inference)
		& KeyOf<TStates>
	]
>;

/**
 * A command factory is a function that creates a command for a given state and message.
 */
type CommandFactory<
	TStates extends Repository,
	TMessages extends Repository,
	TStateConfig extends StateConfig<TStates, TMessages>,
	TState,
	TMessage extends StateConfigMessage<TStates, TMessages, TStateConfig>,
	TModel
> = (payload: {
	model: TModel;
	state: TState;
	message: TMessages[TMessage];
}) => Command<TargetStates<TStates, TMessages, TStateConfig, TMessage>>;

/**
 * Map a state configuration to a set of command factories.
 * For each message in the state configuration, a command factory.
 */
type StateCommands<
	TStates extends Repository,
	TMessages extends Repository,
	TStateConfig extends StateConfig<TStates, TMessages>,
	TState,
	TModel
> = {
	[Message in StateConfigMessage<TStates, TMessages, TStateConfig>]: CommandFactory<
		TStates,
		TMessages,
		TStateConfig,
		TState,
		Message,
		TModel
	>;
};

/**
 * Maps a state machine configuration to all the command factories for each state.
 */
type Commands<
	TModel,
	TStates extends Repository,
	TMessages extends Repository,
	TConfig extends Config<TStates, TMessages>
> = {
	[S in KeyOf<TStates> & KeyOf<TConfig>]: StateCommands<
		TStates,
		TMessages,
		TConfig[S],
		TStates[S],
		TModel
	>;
};

// ========================================================================
// The *actual* state machine
// ========================================================================

/**
 * (utility) Bundles the core types needed to create a state machine.
 */
type Types<TStates extends Repository, TMessages extends Repository> = {
	states: TStates;
	messages: TMessages;
};

/**
 * Use this function to pass the core types when creating a state machine instance.
 * e.g.:
 * ```ts
 * import * as fsm from './state-machine';
 *
 * const machine = new fsm.StateMachine({
 *   types: fsm.types<MyStates, MyMessages>(),
 *   ...
 * });
 */
function types<TStates extends Repository, TMessages extends Repository>(): Types<
	TStates,
	TMessages
> {
	return {} as { states: TStates; messages: TMessages };
}

/**
 * The properties passed to the state machine constructor.
 */
type Props<
	TModel,
	TStates extends Repository,
	TMessages extends UndoRedoRepository,
	TConfig extends Config<TStates, TMessages>
> = {
	model: TModel;
	types: Types<TStates, TMessages>;
	config: TConfig;
	commands: Commands<TModel, TStates, TMessages, TConfig>;
	initialState: AnyState<TStates>;
};

/**
 * The state machine class.
 * When creating an instance, pass the core types using the `types` utility.
 * e.g.:
 * ```ts
 * import * as fsm from './state-machine';
 *
 * const machine = new fsm.StateMachine({
 *   types: fsm.types<MyStates, MyMessages>(),
 *   ...
 * });
 * ```
 */
class StateMachine<
	TModel,
	TStates extends Repository,
	TMessages extends UndoRedoRepository,
	TConfig extends Config<TStates, TMessages>
> {
	constructor(private readonly props: Props<TModel, TStates, TMessages, TConfig>) {}

	private history: HistoryEntry<TStates, TMessages>[] = [];
	private future: HistoryEntry<TStates, TMessages>[] = [];

	getCurrentState(): AnyState<TStates> {
		return this.history.at(-1)?.state ?? this.props.initialState;
	}

	get state() {
		return this.getCurrentState();
	}

	get model() {
		return this.props.model;
	}

	private getCommand(message: AnyMessage<TMessages>): Command<AnyState<TStates>> | undefined {
		const state = this.getCurrentState();
		if (!state || !(state.id in this.props.commands)) return undefined;
		const stateCommands = this.props.commands[state.id];
		if (!(message.id in stateCommands)) return undefined;
		const commandFactory = stateCommands[message.id];
		if (!commandFactory) return undefined;
		// @ts-expect-error - probably error that can be ignored, it should be a slight type mismatch
		return commandFactory({ model: this.props.model, state, message });
	}

	execute(message: AnyMessage<TMessages>) {
		if (message.id === 'undo' || message.id === 'redo') {
			if (!this.canUndoRedo()) return;
			else if (message.id === 'undo') this.undo();
			else if (message.id === 'redo') this.redo();
		} else {
			const command = this.getCommand(message as AnyMessage<TMessages>);
			if (!command) return;
			const state = command.execute();
			this.future = [];
			this.history.push({ state, message: message as AnyMessage<TMessages>, command });
		}
	}

	private canUndoRedo() {
		return !this.props.config[this.state.id].disableUndoRedo;
	}

	private undo() {
		const entry = this.history.pop();
		if (!entry) return;
		entry.command?.undo?.();
		this.future.push(entry);
	}

	private redo() {
		const entry = this.future.pop();
		if (!entry) return;
		entry.command?.execute();
		this.history.push(entry);
	}
}

/**
 * (utility) The history entry type.
 */
type HistoryEntry<TStates extends Repository, TMessages extends Repository> = {
	state: AnyState<TStates>;
	message: AnyMessage<TMessages>;
	command: Command<unknown>;
};

//

export { types, StateMachine };
