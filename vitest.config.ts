import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['backend/**/*.test.ts', 'shared/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['backend/**/*.ts', 'shared/**/*.ts'],
			exclude: ['**/*.test.ts', '**/types.ts', 'backend/serve.ts'],
		},
	},
});
