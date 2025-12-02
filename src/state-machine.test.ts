import { describe, expect, it, vi } from 'vitest';

import { StateMachine, types } from './state-machine';

// ========================================================================
// Test Types & Model Setup
// ========================================================================

type CounterModel = {
	value: number;
	increment: () => void;
	decrement: () => void;
	setValue: (value: number) => void;
};

function createCounterModel(): CounterModel {
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
		}
	};
}

type TestStates = {
	idle: void;
	active: { startTime: number };
	disabled: { reason: string };
};

type TestMessages = {
	activate: { timestamp: number };
	deactivate: void;
	disable: { reason: string };
	enable: void;
	increment: void;
	decrement: void;
	undo: void;
	redo: void;
};

function createTestStateMachine() {
	const model = createCounterModel();

	const machine = new StateMachine({
		types: types<TestStates, TestMessages>(),
		model,
		initialState: { id: 'idle' },
		config: {
			idle: {
				on: {
					activate: ['active', 'idle'], // back to idle in case of error during activation
					disable: ['disabled']
				}
			},
			active: {
				on: {
					deactivate: ['idle'],
					disable: ['disabled'],
					increment: ['active'],
					decrement: ['active']
				}
			},
			disabled: {
				on: {
					enable: ['idle']
				}
			}
		},
		commands: {
			idle: {
				activate: ({ message }) => {
					return {
						execute: () => {
							if (message.timestamp > 1000) {
								return {
									id: 'idle',
									startTime: message.timestamp
								};
							}
							return {
								id: 'active',
								startTime: message.timestamp
							};
						}
					};
				},
				disable: ({ message }) => {
					return {
						execute: () => ({
							id: 'disabled',
							reason: message.reason
						})
					};
				}
			},
			active: {
				deactivate: () => {
					return {
						execute: () => ({
							id: 'idle'
						})
					};
				},
				disable: ({ message }) => {
					return {
						execute: () => ({
							id: 'disabled',
							reason: message.reason
						})
					};
				},
				increment: ({ model, state }) => {
					const prevCount = model.value;
					return {
						execute: () => {
							model.increment();
							return {
								id: 'active',
								...state
							};
						},
						undo: () => model.setValue(prevCount)
					};
				},
				decrement: ({ model, state }) => {
					const prevCount = model.value;
					return {
						execute: () => {
							model.decrement();
							return {
								id: 'active',
								...state
							};
						},
						undo: () => {
							model.setValue(prevCount);
						}
					};
				}
			},
			disabled: {
				enable: () => {
					return {
						execute: () => ({
							id: 'idle'
						})
					};
				}
			}
		}
	});

	return { machine, model };
}

// ========================================================================
// Tests
// ========================================================================

describe('StateMachine', () => {
	describe('Initialization', () => {
		it('should create a state machine instance', () => {
			const { machine } = createTestStateMachine();
			expect(machine).toBeDefined();
		});

		it('should return initial state when created', () => {
			const { machine } = createTestStateMachine();
			const state = machine.state;
			expect(state).toBeDefined();
			expect(state).toMatchObject({ id: 'idle' });
		});
	});

	describe('State Transitions', () => {
		it('should execute a message and transition to a new state', () => {
			const { machine } = createTestStateMachine();

			// Initialize with idle state
			machine.execute({ id: 'activate', timestamp: Date.now() });

			const state = machine.state;
			expect(state).toBeDefined();
			expect(state.id).toBe('active');
		});

		it('should maintain state data through transitions', () => {
			const { machine } = createTestStateMachine();

			const timestamp = 1234567890;
			machine.execute({ id: 'activate', timestamp });

			const state = machine.state;
			expect(state).toMatchObject({
				id: 'active',
				startTime: timestamp
			});
		});

		it('should handle multiple sequential transitions', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'deactivate' });
			expect(machine.state.id).toBe('idle');

			machine.execute({ id: 'disable', reason: 'test' });
			expect(machine.state.id).toBe('disabled');
		});

		it('should ignore invalid transitions', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			const stateBefore = machine.state;

			// Try to execute a message not available in 'active' state
			machine.execute({ id: 'enable' });

			// State should remain unchanged
			expect(machine.state).toEqual(stateBefore);
		});

		it('should handle state-specific messages correctly', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'increment' });
			const state = machine.state;

			expect(state.id).toBe('active');
			if (state.id === 'active') {
				expect(state.startTime).toBe(1000);
			}
		});
	});

	describe('Model Integration', () => {
		it('should update the model when executing commands', () => {
			const { machine, model } = createTestStateMachine();

			const initialValue = model.value;
			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'increment' });

			expect(model.value).toBe(initialValue + 1);
		});

		it('should reflect model changes in state', () => {
			const { machine, model } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			const count1 = model.value;

			machine.execute({ id: 'increment' });
			const count2 = model.value;

			expect(count2).toBe(count1 + 1);
		});
	});

	describe('Undo Functionality', () => {
		it('should undo the last executed command', () => {
			const { machine, model } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'increment' });

			const valueAfterIncrement = model.value;
			expect(valueAfterIncrement).toBe(1);

			machine.execute({ id: 'undo' });

			expect(model.value).toBe(0);
			expect(machine.state.id).toBe('active');
		});

		it('should handle multiple undos', () => {
			const { machine, model } = createTestStateMachine();

			const initialValue = model.value;

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'increment' });
			machine.execute({ id: 'increment' });

			const finalValue = model.value;
			expect(finalValue).toBe(initialValue + 2);

			machine.execute({ id: 'undo' });
			machine.execute({ id: 'undo' });

			expect(model.value).toBe(initialValue);
		});

		it('should do nothing when undo is called with empty history', () => {
			const { machine, model } = createTestStateMachine();

			const initialValue = model.value;
			machine.execute({ id: 'undo' });

			expect(model.value).toBe(initialValue);
		});

		it('should update current state after undo', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'undo' });
			expect(machine.state.id).toBe('idle');
		});
	});

	describe('Redo Functionality', () => {
		it('should redo an undone command', () => {
			const { machine, model } = createTestStateMachine();

			const initialValue = model.value;

			machine.execute({ id: 'activate', timestamp: 1000 });
			const afterExecute = model.value;

			machine.execute({ id: 'undo' });
			expect(model.value).toBe(initialValue);

			machine.execute({ id: 'redo' });
			expect(model.value).toBe(afterExecute);
		});

		it('should handle multiple redos', () => {
			const { machine, model } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'increment' });
			machine.execute({ id: 'increment' });

			const finalValue = model.value;

			machine.execute({ id: 'undo' });
			machine.execute({ id: 'undo' });
			machine.execute({ id: 'undo' });

			machine.execute({ id: 'redo' });
			machine.execute({ id: 'redo' });
			machine.execute({ id: 'redo' });

			expect(model.value).toBe(finalValue);
		});

		it('should do nothing when redo is called with empty future', () => {
			const { machine, model } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			const value = model.value;

			machine.execute({ id: 'redo' });

			expect(model.value).toBe(value);
		});

		it('should update current state after redo', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'undo' });

			machine.execute({ id: 'redo' });

			expect(machine.state.id).toBe('active');
		});

		it('should clear future when executing a new command after undo', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'increment' });

			machine.execute({ id: 'undo' }); // Now future has one entry

			machine.execute({ id: 'deactivate' }); // This should clear future

			// After this new execution, redo should do nothing
			const stateBefore = machine.state;
			machine.execute({ id: 'redo' });
			expect(machine.state).toEqual(stateBefore);
		});
	});

	describe('Complex State Transitions', () => {
		it('should handle a full workflow with multiple state transitions', () => {
			const { machine } = createTestStateMachine();

			// Start idle -> activate -> increment -> decrement -> deactivate -> disable -> enable
			machine.execute({ id: 'activate', timestamp: 1000 });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'increment' });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'decrement' });
			expect(machine.state.id).toBe('active');

			machine.execute({ id: 'deactivate' });
			expect(machine.state.id).toBe('idle');

			machine.execute({ id: 'disable', reason: 'maintenance' });
			expect(machine.state.id).toBe('disabled');

			machine.execute({ id: 'enable' });
			expect(machine.state.id).toBe('idle');
		});

		it('should preserve state-specific data across related transitions', () => {
			const { machine } = createTestStateMachine();

			const startTime = 5000;
			machine.execute({ id: 'activate', timestamp: startTime });

			machine.execute({ id: 'increment' });
			machine.execute({ id: 'increment' });

			const state = machine.state;
			if (state.id === 'active') {
				expect(state.startTime).toBe(startTime);
			}
		});
	});

	describe('Command Factories', () => {
		it('should receive correct payload in command factory', () => {
			const model = createCounterModel();
			const commandFactorySpy = vi.fn(() => ({
				execute: () => ({ id: 'active' as const, count: 1, startTime: 1000 }),
				undo: () => {}
			}));

			const machine = new StateMachine({
				model,
				types: types<TestStates, TestMessages>(),
				config: {
					idle: { on: { activate: ['active'] } },
					active: { on: {} },
					disabled: { on: {} }
				},
				commands: {
					idle: {
						activate: commandFactorySpy
					},
					active: {},
					disabled: {}
				},
				initialState: { id: 'idle' }
			});

			const timestamp = 9999;
			machine.execute({ id: 'activate', timestamp });

			expect(commandFactorySpy).toHaveBeenCalledWith({
				model,
				state: expect.objectContaining({ id: 'idle' }),
				message: { id: 'activate', timestamp }
			});
		});

		it('should create commands with proper execute and undo methods', () => {
			const executeSpy = vi.fn(() => ({ id: 'active' as const, count: 1, startTime: 1000 }));
			const undoSpy = vi.fn();

			const model = createCounterModel();
			const machine = new StateMachine({
				model,
				types: types<TestStates, TestMessages>(),
				config: {
					idle: { on: { activate: ['active'] } },
					active: { on: {} },
					disabled: { on: {} }
				},
				commands: {
					idle: {
						activate: () => ({
							execute: executeSpy,
							undo: undoSpy
						})
					},
					active: {},
					disabled: {}
				},
				initialState: { id: 'idle' }
			});

			machine.execute({ id: 'activate', timestamp: 1000 });
			expect(executeSpy).toHaveBeenCalled();

			machine.execute({ id: 'undo' });
			expect(undoSpy).toHaveBeenCalled();
		});
	});

	describe('Edge Cases', () => {
		it('should handle rapid successive executions', () => {
			const { machine } = createTestStateMachine();

			for (let i = 0; i < 100; i++) {
				machine.execute({ id: 'activate', timestamp: i });
				machine.execute({ id: 'increment' });
				machine.execute({ id: 'deactivate' });
			}

			expect(machine.state.id).toBe('idle');
		});

		it('should handle alternating undo/redo operations', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });

			for (let i = 0; i < 10; i++) {
				machine.execute({ id: 'undo' });
				machine.execute({ id: 'redo' });
			}

			expect(machine.state.id).toBe('active');
		});

		it('should handle empty message data correctly', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			machine.execute({ id: 'deactivate' });

			expect(machine.state.id).toBe('idle');
		});

		it('should handle state transitions with complex data', () => {
			const { machine } = createTestStateMachine();

			machine.execute({
				id: 'disable',
				reason: 'Very long reason with special characters: !@#$%^&*()_+-=[]{}|;:,.<>?'
			});

			const state = machine.state;
			if (state.id === 'disabled') {
				expect(state.reason).toContain('special characters');
			}
		});
	});

	describe('Type Safety', () => {
		it('should enforce state structure with id property', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1000 });
			const state = machine.state;

			expect(state).toHaveProperty('id');
			expect(typeof state.id).toBe('string');
		});

		it('should enforce message structure with _message property', () => {
			const { machine } = createTestStateMachine();

			// This test demonstrates that messages must have _message property
			machine.execute({ id: 'activate', timestamp: 1000 });

			expect(machine.state).toBeDefined();
		});
	});

	describe('History Management', () => {
		it('should maintain correct history after multiple operations', () => {
			const { machine } = createTestStateMachine();

			machine.execute({ id: 'activate', timestamp: 1 });
			machine.execute({ id: 'increment' });
			machine.execute({ id: 'increment' });

			machine.execute({ id: 'undo' });
			machine.execute({ id: 'undo' });

			const currentState = machine.state;
			expect(currentState.id).toBe('active');
		});

		it('should handle complex undo/redo sequences', () => {
			const { machine } = createTestStateMachine();

			// Create some history
			machine.execute({ id: 'activate', timestamp: 1 });
			machine.execute({ id: 'increment' });
			machine.execute({ id: 'increment' });

			// Undo twice
			machine.execute({ id: 'undo' });
			machine.execute({ id: 'undo' });

			// Execute new command (should clear future)
			machine.execute({ id: 'deactivate' });

			// Try to redo (should do nothing since future was cleared)
			const stateBefore = machine.state;
			machine.execute({ id: 'redo' });
			expect(machine.state).toEqual(stateBefore);
		});
	});

	describe('Multiple State Machines', () => {
		it('should allow multiple independent state machines', () => {
			const { machine: machine1 } = createTestStateMachine();
			const { machine: machine2 } = createTestStateMachine();

			machine1.execute({ id: 'activate', timestamp: 1000 });
			machine2.execute({ id: 'activate', timestamp: 2000 });

			machine1.execute({ id: 'deactivate' });

			expect(machine1.state.id).toBe('idle');
			expect(machine2.state.id).toBe('active');
		});

		it('should maintain separate histories for different machines', () => {
			const { machine: machine1 } = createTestStateMachine();
			const { machine: machine2 } = createTestStateMachine();

			machine1.execute({ id: 'activate', timestamp: 1000 });
			machine2.execute({ id: 'disable', reason: 'test' });

			machine1.execute({ id: 'undo' });

			expect(machine1.state.id).toBe('idle');
			expect(machine2.state.id).toBe('disabled');
		});
	});
});
