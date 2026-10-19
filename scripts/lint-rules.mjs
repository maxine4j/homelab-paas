export const noRecursiveTypes = {
	meta: {
		type: "problem",
		schema: [],
		messages: { recursive: "Recursive types are forbidden; define finite explicit shapes." },
	},
	create(context) {
		const declarations = new Map();
		const namespaces = new Map();
		const references = [];
		const inferred = [];
		const isScope = (node) => ["Program", "BlockStatement", "TSModuleBlock"].includes(node.type);
		function scopeOf(node) {
			for (let parent = node.parent; parent; parent = parent.parent) if (isScope(parent)) return parent;
			return null;
		}
		function register(node) {
			declarations.set(node, { node, scope: scopeOf(node), name: node.id.name, edges: new Set() });
		}
		function within(node, container) {
			for (let parent = node; parent; parent = parent.parent) if (parent === container) return true;
			return false;
		}
		function parts(node) {
			if (node.type === "Identifier") return [node.name];
			if (node.type === "TSQualifiedName") return [...parts(node.left), node.right.name];
			if (node.type === "MemberExpression" && !node.computed) return [...parts(node.object), node.property.name];
			return [];
		}
		function collect(node, name) {
			const names = parts(name);
			if (!names.length) return;
			let owner;
			for (let parent = node; parent; parent = parent.parent) {
				const parameters = parent.typeParameters?.params ?? [];
				if (parameters.some((parameter) => (parameter.name.name ?? parameter.name) === names.at(0))) return;
				if (
					parent.type === "TSMappedType"
					&& parent.key.name === names.at(0)
					&& !within(node, parent.constraint)
				)
					return;
				if (!owner && declarations.has(parent)) owner = declarations.get(parent);
			}
			if (owner) references.push({ node, owner, names, scope: scopeOf(node) });
		}
		function lookup(entries, scope, name) {
			for (let current = scope; current; current = scopeOf(current)) {
				const entry = entries.find((candidate) => candidate.scope === current && candidate.name === name);
				if (entry) return entry;
			}
			return undefined;
		}
		return {
			TSTypeAliasDeclaration: register,
			TSInterfaceDeclaration: register,
			TSModuleDeclaration(node) {
				namespaces.set(node, { node, scope: scopeOf(node), name: node.id.name });
			},
			TSTypeReference(node) {
				collect(node, node.typeName);
			},
			TSInterfaceHeritage(node) {
				collect(node, node.expression);
			},
			TSInferType(node) {
				for (let parent = node.parent; parent; parent = parent.parent) {
					if (parent.type === "TSConditionalType") {
						inferred.push({ name: node.typeParameter.name.name, scope: parent.trueType });
						break;
					}
				}
			},
			"Program:exit"() {
				const types = [...declarations.values()];
				for (const { node, owner, names, scope } of references) {
					if (inferred.some((binding) => binding.name === names.at(0) && within(node, binding.scope)))
						continue;
					let targetScope = scope;
					for (const name of names.slice(0, -1)) {
						targetScope = lookup([...namespaces.values()], targetScope, name)?.node.body ?? null;
					}
					const target = lookup(types, targetScope, names.at(-1));
					if (target) owner.edges.add(target);
				}
				for (const declaration of types) {
					const pending = [...declaration.edges];
					const visited = new Set();
					while (pending.length) {
						const current = pending.pop();
						if (current === declaration) {
							context.report({ node: declaration.node.id, messageId: "recursive" });
							break;
						}
						if (visited.has(current)) continue;
						visited.add(current);
						pending.push(...current.edges);
					}
				}
			},
		};
	},
};

export default {
	meta: { name: "homelab" },
	rules: { "no-recursive-types": noRecursiveTypes },
};
