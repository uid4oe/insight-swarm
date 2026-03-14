export function drawLabel(
	context: CanvasRenderingContext2D,
	// biome-ignore lint/suspicious/noExplicitAny: sigma node attrs are untyped
	data: any,
	// biome-ignore lint/suspicious/noExplicitAny: sigma settings type not exported
	settings: any,
) {
	const isThesis = data.nodeType === "thesis";

	if (!data.label) return;

	const label = data.label as string;
	const fontSize = isThesis ? settings.labelSize + 2 : settings.labelSize;
	const font = settings.labelFont;
	const weight = isThesis ? "700" : "600";

	context.font = `${weight} ${fontSize}px ${font}`;
	context.textAlign = "center";
	context.textBaseline = "middle";

	// Draw label centered on node
	context.fillStyle = "rgba(0,0,0,0.8)";
	context.fillText(label, data.x + 1, data.y + 1);
	context.fillStyle = isThesis ? "#fff" : "rgba(240,240,244,0.95)";
	context.fillText(label, data.x, data.y);

	// Reset alignment for other renderers
	context.textAlign = "start";
	context.textBaseline = "alphabetic";
}
