// ── Gemini Safety Settings ──────────────────────────────────────────────────
// Relaxed content filters for investment due diligence research.
// Only DANGEROUS_CONTENT is fully disabled — it blocks legitimate queries
// about regulated industries, weapons manufacturers, and dual-use technologies.
// Other categories use LOW_AND_ABOVE threshold to avoid false positives while
// still catching genuinely problematic content.

import { HarmBlockThreshold, HarmCategory } from '@google/genai';

export const PERMISSIVE_SAFETY = [
	// Fully disabled — blocks legitimate DD on defence, pharma, chemicals, etc.
	{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
	// Relaxed but not fully disabled — DD shouldn't produce this content, but
	// safety filters can false-positive on aggressive competitive analysis.
	{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
	{ category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
	// Default threshold — DD has no reason to produce sexually explicit content.
	{ category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];
