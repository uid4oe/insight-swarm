// Cache hex→RGB conversions to avoid regex parsing every frame
const rgbCache = new Map<string, { r: number; g: number; b: number }>();

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const cached = rgbCache.get(hex);
	if (cached) return cached;
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!result) return null;
	const rgb = {
		r: Number.parseInt(result[1], 16),
		g: Number.parseInt(result[2], 16),
		b: Number.parseInt(result[3], 16),
	};
	rgbCache.set(hex, rgb);
	return rgb;
}

function wrapLabel(text: string, maxCharsPerLine: number): string[] {
	if (text.length <= maxCharsPerLine) return [text];
	const mid = Math.min(maxCharsPerLine, text.length);
	let breakIdx = text.lastIndexOf(" ", mid);
	if (breakIdx < 8) breakIdx = mid;
	const line1 = text.slice(0, breakIdx).trim();
	let line2 = text.slice(breakIdx).trim();
	if (line2.length > maxCharsPerLine) {
		line2 = `${line2.slice(0, maxCharsPerLine - 2)}...`;
	}
	return line2 ? [line1, line2] : [line1];
}

export function drawLabel(
	context: CanvasRenderingContext2D,
	// biome-ignore lint/suspicious/noExplicitAny: sigma node attrs are untyped
	data: any,
	// biome-ignore lint/suspicious/noExplicitAny: sigma settings type not exported
	settings: any,
) {
	const isThesis = data.nodeType === "thesis";

	if (isThesis) {
		const emergence = data.emergence ?? 1;
		const glowRadius = data.size * 2.2 + emergence * 3;
		const rgb = hexToRgb(data.color);
		if (rgb) {
			const gradient = context.createRadialGradient(data.x, data.y, data.size * 0.5, data.x, data.y, glowRadius);
			gradient.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`);
			gradient.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.06)`);
			gradient.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
			context.fillStyle = gradient;
			context.beginPath();
			context.arc(data.x, data.y, glowRadius, 0, Math.PI * 2);
			context.fill();
		}

		if (emergence >= 3 && rgb) {
			const t = (performance.now() % 3500) / 3500;
			const pulseRadius = data.size * (1.4 + t * 1.8);
			const pulseAlpha = Math.max(0, 0.2 * (1 - t));
			context.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${pulseAlpha})`;
			context.lineWidth = 1.5;
			context.beginPath();
			context.arc(data.x, data.y, pulseRadius, 0, Math.PI * 2);
			context.stroke();
		}
	}

	if (!data.label) return;

	const fontSize = isThesis ? settings.labelSize + 4 : settings.labelSize + 1;
	const font = settings.labelFont;
	const weight = isThesis ? "600" : "500";
	const labelColor = isThesis ? "#f0f0f4" : "rgba(200,205,220,0.88)";

	context.font = `${weight} ${fontSize}px ${font}`;
	const maxChars = isThesis ? 26 : 20;
	const lines = wrapLabel(data.label, maxChars);
	const lineHeight = fontSize * 1.25;
	const xOffset = data.size + 8;
	const yBase = data.y - ((lines.length - 1) * lineHeight) / 2;

	// Text shadow for readability on dark backgrounds
	context.fillStyle = "rgba(0,0,0,0.75)";
	for (let i = 0; i < lines.length; i++) {
		context.fillText(lines[i], data.x + xOffset + 1, yBase + i * lineHeight + 1);
		context.fillText(lines[i], data.x + xOffset - 1, yBase + i * lineHeight);
	}
	context.fillStyle = labelColor;
	for (let i = 0; i < lines.length; i++) {
		context.fillText(lines[i], data.x + xOffset, yBase + i * lineHeight);
	}
}
