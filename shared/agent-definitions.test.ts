import { describe, expect, it } from 'vitest';
import {
	AGENT_DEFINITIONS,
	AGENT_DEFINITION_MAP,
	ALL_AGENT_IDS,
	BUILTIN_AGENT_IDS,
	customToAgentDefinition,
	normalizeAgentId,
} from './agent-definitions.js';

describe('AGENT_DEFINITIONS', () => {
	it('has exactly 5 agents', () => {
		expect(AGENT_DEFINITIONS).toHaveLength(5);
	});

	it('contains all expected agent IDs', () => {
		const ids = AGENT_DEFINITIONS.map((d) => d.id);
		expect(ids).toEqual(['financial', 'operational', 'legal', 'market', 'management']);
	});

	it('ALL_AGENT_IDS matches definitions', () => {
		expect(ALL_AGENT_IDS).toEqual(AGENT_DEFINITIONS.map((d) => d.id));
	});

	it('BUILTIN_AGENT_IDS is a Set of all IDs', () => {
		expect(BUILTIN_AGENT_IDS).toBeInstanceOf(Set);
		expect(BUILTIN_AGENT_IDS.size).toBe(5);
		for (const id of ALL_AGENT_IDS) {
			expect(BUILTIN_AGENT_IDS.has(id)).toBe(true);
		}
	});

	it('AGENT_DEFINITION_MAP maps id to definition', () => {
		expect(AGENT_DEFINITION_MAP.get('financial')?.label).toBe('FINANCIAL');
		expect(AGENT_DEFINITION_MAP.get('legal')?.shortLabel).toBe('Legal');
	});

	it('each agent has required fields', () => {
		for (const def of AGENT_DEFINITIONS) {
			expect(def.id).toBeTruthy();
			expect(def.label).toBeTruthy();
			expect(def.shortLabel).toBeTruthy();
			expect(def.color).toMatch(/^#[0-9a-f]{6}$/i);
			expect(def.description).toBeTruthy();
			expect(def.perspective).toBeTruthy();
		}
	});
});

describe('normalizeAgentId', () => {
	it('adds agent_ prefix when missing', () => {
		expect(normalizeAgentId('custom')).toBe('agent_custom');
	});

	it('does not double-prefix', () => {
		expect(normalizeAgentId('agent_custom')).toBe('agent_custom');
	});
});

describe('customToAgentDefinition', () => {
	it('converts custom definition to full definition', () => {
		const custom = {
			id: 'risk',
			label: 'Risk Analyst',
			perspective: 'Risk assessment',
			color: '#ff0000',
			description: 'Evaluates risks',
		};
		const result = customToAgentDefinition(custom);
		expect(result.id).toBe('agent_risk');
		expect(result.label).toBe('RISK ANALYST');
		expect(result.shortLabel).toBe('Risk Analyst');
		expect(result.color).toBe('#ff0000');
		expect(result.description).toBe('Evaluates risks');
		expect(result.perspective).toBe('Risk assessment');
	});

	it('preserves agent_ prefix if already present', () => {
		const custom = {
			id: 'agent_esg',
			label: 'ESG',
			perspective: 'ESG',
			color: '#00ff00',
			description: 'ESG analysis',
		};
		expect(customToAgentDefinition(custom).id).toBe('agent_esg');
	});
});
