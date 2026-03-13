import type Graph from "graphology";

// Lazy-cached dimmed color — avoids getComputedStyle at module load time
let _dimmedColor: string | null = null;
function getDimmedColor(): string {
	if (!_dimmedColor) {
		_dimmedColor =
			getComputedStyle(document.documentElement).getPropertyValue("--color-graph-dimmed").trim() || "#16161e";
	}
	return _dimmedColor;
}

export function createNodeReducer(
	effectiveHover: string | null,
	neighbors: Map<string, Set<string>>,
	thesisEvidenceSets: Map<string, Set<string>>,
) {
	// Early exit — no hover means identity reducer
	if (!effectiveHover) {
		// biome-ignore lint/suspicious/noExplicitAny: sigma node attrs are untyped
		return (_node: string, data: any) => data;
	}

	const dimmed = getDimmedColor();
	const isThesisFocus = effectiveHover.startsWith("thesis:");
	const evidenceSet = isThesisFocus ? thesisEvidenceSets.get(effectiveHover) : null;
	const neighborSet = !isThesisFocus ? neighbors.get(effectiveHover) : null;

	// biome-ignore lint/suspicious/noExplicitAny: sigma node attrs are untyped
	return (node: string, data: any) => {
		if (isThesisFocus && evidenceSet) {
			if (node === effectiveHover) {
				return { ...data, zIndex: 2, forceLabel: true, size: data.size * 1.5 };
			}
			if (evidenceSet.has(node)) {
				return { ...data, zIndex: 1, forceLabel: true, size: data.size * 1.25 };
			}
			return { ...data, color: dimmed, label: null, zIndex: 0, size: data.size * 0.8 };
		}

		if (node === effectiveHover) {
			return { ...data, zIndex: 2, forceLabel: true, size: data.size * 1.4 };
		}
		if (neighborSet?.has(node)) {
			return { ...data, zIndex: 1, forceLabel: true, size: data.size * 1.2 };
		}
		return { ...data, color: dimmed, label: null, zIndex: 0, size: data.size * 0.8 };
	};
}

export function createEdgeReducer(
	effectiveHover: string | null,
	graph: Graph,
	thesisEvidenceSets: Map<string, Set<string>>,
) {
	// Early exit — no hover means identity reducer
	if (!effectiveHover) {
		// biome-ignore lint/suspicious/noExplicitAny: sigma edge attrs are untyped
		return (_edge: string, data: any) => data;
	}

	const isThesisFocus = effectiveHover.startsWith("thesis:");
	const evidenceSet = isThesisFocus ? thesisEvidenceSets.get(effectiveHover) : null;

	// biome-ignore lint/suspicious/noExplicitAny: sigma edge attrs are untyped
	return (edge: string, data: any) => {
		try {
			const source = graph.source(edge);
			const target = graph.target(edge);
			if (isThesisFocus && evidenceSet) {
				const sourceIn = evidenceSet.has(source) || source === effectiveHover;
				const targetIn = evidenceSet.has(target) || target === effectiveHover;
				if (sourceIn && targetIn) {
					return {
						...data,
						size: Math.max(data.size * 2.5, 2),
						zIndex: data.isContradicts ? 2 : 1,
					};
				}
				return { ...data, hidden: true };
			}

			if (source === effectiveHover || target === effectiveHover) {
				return {
					...data,
					size: data.isContradicts ? Math.max(data.size * 2, 3) : Math.max(data.size * 1.5, 1),
					zIndex: data.isContradicts ? 2 : 1,
				};
			}
			return { ...data, hidden: true };
		} catch {
			return { ...data, hidden: true };
		}
	};
}
