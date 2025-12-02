import type { TSESTree} from 'npm:@typescript-eslint/types';

import { AST_NODE_TYPES, ESLintUtils } from 'npm:@typescript-eslint/utils';


// 

const createRule = ESLintUtils.RuleCreator(
	(name) => `https://github.com/bbtgnn/filo/eslint-rules#${name}`
);

/**
 * Custom ESLint rule to check StateMachine command implementations
 *
 * This rule ensures that when a state transition can result in multiple target states,
 * the command implementation should be able to return all of those states, not just one.
 */
const stateMachineUnionReturnRule = createRule({
	name: 'state-machine-union-return',
	meta: {
		type: 'problem',
		docs: {
			description:
				'Ensure command factories can return all possible target states when multiple states are declared'
		},
		messages: {
			missingUnionReturn:
				'The "{{message}}" message can transition to {{count}} states [{{states}}], but execute() only ever returns "{{actualState}}". Consider adding conditional logic to return different states based on the situation.',
			alwaysSameState:
				'The "{{message}}" message declares {{count}} possible target states [{{states}}], but your implementation always returns "{{actualState}}". If only one state is possible, update the config to reflect this.'
		},
		schema: []
	},
	defaultOptions: [],

	create(context) {
		return {
			/**
			 * Match both:
			 * - new StateMachine({...})
			 * - new fsm.StateMachine({...})
			 * @param {NewExpression} node
			 */
			NewExpression(node) {
				// Check if this is a StateMachine construction
				const isStateMachine =
					// Direct: new StateMachine(...)
					(node.callee.type === 'Identifier' && node.callee.name === 'StateMachine') ||
					// Namespaced: new fsm.StateMachine(...) or new something.StateMachine(...)
					(node.callee.type === 'MemberExpression' &&
						node.callee.property.type === 'Identifier' &&
						node.callee.property.name === 'StateMachine');

				if (!isStateMachine) return;

				if (node.arguments.length === 0 || node.arguments[0].type !== 'ObjectExpression') {
					return;
				}

				const configObj = node.arguments[0];

				// Extract config and commands properties
				/** @type {ObjectExpression | null} */
				let configProp = null;
				/** @type {ObjectExpression | null} */
				let commandsProp = null;

				for (const prop of configObj.properties) {
					if (prop.type === 'Property' && prop.key.type === 'Identifier') {
						if (prop.key.name === 'config' && prop.value.type === 'ObjectExpression')
							configProp = prop.value;
						if (prop.key.name === 'commands' && prop.value.type === 'ObjectExpression')
							commandsProp = prop.value;
					}
				}

				if (!configProp || !commandsProp) return;

				// Parse config to build transition map
				const transitions = parseStateMachineConfig(configProp);

				// Check commands
				checkCommands(commandsProp, transitions, context);
			}
		};
	}
});


function parseStateMachineConfig(configNode: TSESTree.ObjectExpression) {
	const transitions = new Map();

	for (const stateProp of configNode.properties) {
		if (stateProp.type !== 'Property' || stateProp.key.type !== 'Identifier') continue;

		const stateName = stateProp.key.name;
		const stateConfig = stateProp.value;
		if (stateConfig.type !== 'ObjectExpression') continue;

		// Find 'on' property
		const onProp = stateConfig.properties.find(
			(p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'on'
		);

		if (
			!onProp ||
			onProp.type !== 'Property' ||
			!onProp.value ||
			onProp.value.type !== 'ObjectExpression'
		)
			continue;

		const messageMap = new Map();

		for (const msgProp of onProp.value.properties) {
			if (msgProp.type !== 'Property' || msgProp.key.type !== 'Identifier') continue;

			const messageName = msgProp.key.name;
			const targetStates = [];

			if (msgProp.value.type === 'ArrayExpression') {
				for (const elem of msgProp.value.elements) {
					if (elem && elem.type === 'Literal' && typeof elem.value === 'string') {
						targetStates.push(elem.value);
					}
				}
			}

			if (targetStates.length > 0) {
				messageMap.set(messageName, targetStates);
			}
		}

		transitions.set(stateName, messageMap);
	}

	return transitions;
}


function checkCommands(commandsNode: TSESTree.ObjectExpression, transitions: Map<string, Map<string, string[]>>, context: RuleContext<"missingUnionReturn" | "alwaysSameState", []>) {
	for (const stateProp of commandsNode.properties) {
		if (stateProp.type !== 'Property' || stateProp.key.type !== 'Identifier') continue;

		const stateName = stateProp.key.name;
		const stateValue = stateProp.value;

		if (stateValue.type !== 'ObjectExpression') continue;

		const messageMap = transitions.get(stateName);
		if (!messageMap) continue;

		for (const msgProp of stateValue.properties) {
			if (msgProp.type !== 'Property' || msgProp.key.type !== 'Identifier') continue;

			const messageName = msgProp.key.name;
			const targetStates = messageMap.get(messageName);

			// Only check if multiple target states are declared
			if (!targetStates || targetStates.length <= 1) {
				continue;
			}

			const commandFactory = msgProp.value;
			analyzeCommandFactory(commandFactory, messageName, targetStates, context);
		}
	}
}


function analyzeCommandFactory(factoryNode: TSESTree.Node, messageName: string, targetStates: string[], context: RuleContext<"missingUnionReturn" | "alwaysSameState", []>) {
	// Find the returned object with execute method
	const executeFunc = findExecuteMethod(factoryNode);
	if (!executeFunc) return;

	// Analyze what states the execute function returns
	const returnedStateIds = findReturnedStateIds(executeFunc);

	// Check if only one state is ever returned
	if (returnedStateIds.size === 1) {
		const returnedState = Array.from(returnedStateIds)[0];

		context.report({
			node: executeFunc,
			messageId: 'alwaysSameState',
			data: {
				message: messageName,
				count: targetStates.length.toString(),
				states: targetStates.join(', '),
				actualState: returnedState
			}
		});
	} else if (returnedStateIds.size > 0 && returnedStateIds.size < targetStates.length) {
		// Some but not all states are returned
		const returnedState = Array.from(returnedStateIds).join(', ');

		context.report({
			node: executeFunc,
			messageId: 'missingUnionReturn',
			data: {
				message: messageName,
				count: targetStates.length.toString(),
				states: targetStates.join(', '),
				actualState: returnedState
			}
		});
	}
}


function findExecuteMethod(node: TSESTree.Node) {
	// Handle: ({ ... }) => ({ execute: () => ... })
	if (node.type === 'ArrowFunctionExpression') {
		const body = node.body;

		// Implicit return of object
		if (body.type === 'ObjectExpression') {
			return getExecuteFromObject(body);
		}

		// Explicit return
		if (body.type === 'BlockStatement') {
			for (const stmt of body.body) {
				if (stmt.type === 'ReturnStatement' && stmt.argument) {
					if (stmt.argument.type === 'ObjectExpression') {
						return getExecuteFromObject(stmt.argument);
					}
				}
			}
		}
	}

	// Handle: function({ ... }) { return { execute: () => ... } }
	if (node.type === 'FunctionExpression') {
		if (node.body.type === 'BlockStatement') {
			for (const stmt of node.body.body) {
				if (stmt.type === 'ReturnStatement' && stmt.argument) {
					if (stmt.argument.type === 'ObjectExpression') {
						return getExecuteFromObject(stmt.argument);
					}
				}
			}
		}
	}

	return null;
}


function getExecuteFromObject(objNode: TSESTree.ObjectExpression) {
	for (const prop of objNode.properties) {
		if (prop.type === 'Property' && prop.key.type === 'Identifier' && prop.key.name === 'execute') {
			if (
				prop.value.type === AST_NODE_TYPES.FunctionExpression ||
				prop.value.type === AST_NODE_TYPES.ArrowFunctionExpression
			) {
				return prop.value;
			}
		}
	}
	return null;
}


function findReturnedStateIds(funcNode: TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression) {
	const stateIds = new Set();
	const visited = new WeakSet();

	function visit(node: TSESTree.Node | TSESTree.Expression | TSESTree.Statement | TSESTree.Statement[]) {
		if (!node || typeof node !== 'object' || visited.has(node)) return;
		visited.add(node);

		if ('type' in node) {
			// Handle arrow function with implicit return: () => ({...})
			if (
				node.type === AST_NODE_TYPES.ArrowFunctionExpression &&
				node.body.type !== AST_NODE_TYPES.BlockStatement
			) {
				const stateId = extractStateIdFromExpression(node.body);
				if (stateId) {
					stateIds.add(stateId);
				}
			}

			// Look for explicit return statements
			if (node.type === AST_NODE_TYPES.ReturnStatement && node.argument) {
				const stateId = extractStateIdFromExpression(node.argument);
				if (stateId) {
					stateIds.add(stateId);
				}
			}
		}

		// Visit child nodes
		if ('body' in node && node.body) {
			if (Array.isArray(node.body)) {
				node.body.forEach(visit);
			} else {
				visit(node.body);
			}
		}

		if ('consequent' in node && node.consequent) visit(node.consequent);
		if ('alternate' in node && node.alternate) visit(node.alternate);
		if ('argument' in node && node.argument) visit(node.argument);
		if ('cases' in node && node.cases) node.cases.forEach(visit);
	}

	visit(funcNode);
	return stateIds;
}


function extractStateIdFromExpression(expression: TSESTree.ObjectExpression) {
	if (expression.type !== 'ObjectExpression') return null;
	for (const prop of expression.properties) {
		if (prop.type === 'Property' && prop.key.type === 'Identifier' && prop.key.name === 'id') {
			if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
				return prop.value.value;
			}
		}
	}
}

/*  */

const plugin = {
	rules: {
		'state-machine-union-return': stateMachineUnionReturnRule
	}
};

export const eslintConfig = {
	files: ['**/*.ts', '**/*.tsx', '**/*.svelte'],
	languageOptions: {
		parserOptions: {
			projectService: true
		}
	},
	plugins: { 'state-machine': plugin },
	rules: {
		'state-machine/state-machine-union-return': 'error'
	}
};

export default plugin;
