/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Backend API URL — set for production (e.g. https://api.yoursite.com). Empty in dev (Vite proxy). */
	readonly VITE_API_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
