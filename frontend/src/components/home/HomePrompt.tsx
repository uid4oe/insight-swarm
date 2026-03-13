import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT_DEFINITIONS } from "../../../../shared/agent-definitions.js";

const EXAMPLE_PROMPTS = [
	"Stripe IPO at $65B",
	"OpenAI $300B — justified?",
	"Rivian long-term outlook",
	"Databricks vs Snowflake",
] as const;

const TEXTAREA_MIN_HEIGHT = 56;
const TEXTAREA_MAX_HEIGHT = 200;
const MIN_AGENTS = 2;
const MAX_PROMPT_LENGTH = 2000;

// Default selection: all DD agents
const DEFAULT_SELECTED = new Set(AGENT_DEFINITIONS.map((d) => d.id));

interface Props {
	creating: boolean;
	onSubmit: (prompt: string, selectedAgents?: string[]) => void;
}

export function HomePrompt({ creating, onSubmit }: Props) {
	const [value, setValue] = useState("");
	const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const autoResize = useCallback(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(Math.max(el.scrollHeight, TEXTAREA_MIN_HEIGHT), TEXTAREA_MAX_HEIGHT)}px`;
	}, []);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	useEffect(() => {
		// Re-run when value changes to adjust textarea height
		if (value !== undefined) autoResize();
	}, [value, autoResize]);

	const canSubmit = value.trim() && value.length <= MAX_PROMPT_LENGTH && !creating && selectedAgents.size >= MIN_AGENTS;

	const [exiting, setExiting] = useState(false);

	const handleSubmit = () => {
		const trimmed = value.trim();
		if (trimmed && !creating && selectedAgents.size >= MIN_AGENTS) {
			setExiting(true);
			const agentIds = [...selectedAgents];
			onSubmit(trimmed, agentIds);
		}
	};

	const toggleAgent = useCallback((agentId: string) => {
		setSelectedAgents((prev) => {
			const next = new Set(prev);
			if (next.has(agentId)) {
				// Don't allow deselecting below minimum
				if (next.size <= MIN_AGENTS) return prev;
				next.delete(agentId);
			} else {
				next.add(agentId);
			}
			return next;
		});
	}, []);

	return (
		<div
			className={`flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-12 transition-all duration-300 ${exiting ? "opacity-0 scale-[0.97] translate-y-[-8px]" : ""}`}
		>
			<div className="w-full max-w-xl space-y-8">
				{/* ── Header ── */}
				<div className="animate-stagger-up text-center space-y-3" style={{ animationDelay: "0ms" }}>
					<h2 className="text-[32px] font-light tracking-[-0.02em] leading-[1.2] text-text-primary">Insight Swarm</h2>
					<p className="text-[14px] text-text-tertiary">Multi-agent investment due diligence</p>
				</div>

				{/* ── Input ── */}
				<div className="animate-stagger-up" style={{ animationDelay: "80ms" }}>
					<div className="chat-input-container group relative rounded-2xl border border-border/70 bg-panel shadow-elevated transition-[border-color,box-shadow] duration-200 focus-within:border-accent/30">
						<textarea
							ref={textareaRef}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSubmit();
								}
							}}
							placeholder="What should we analyze?"
							disabled={creating}
							maxLength={MAX_PROMPT_LENGTH}
							rows={1}
							className="block w-full resize-none bg-transparent py-4 pr-14 pl-5 text-[15px] leading-relaxed text-text-primary placeholder:text-dim focus:outline-none"
							style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
						/>
						<button
							type="button"
							onClick={handleSubmit}
							disabled={!canSubmit}
							aria-label="Submit analysis"
							className="absolute right-3 bottom-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent-strong text-white transition-all hover:bg-[#5a96f7] disabled:cursor-default disabled:opacity-25"
						>
							{creating ? (
								<span
									className="spinner"
									style={{ width: 14, height: 14, borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }}
								/>
							) : (
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<title>Send</title>
									<path d="M5 12h14M12 5l7 7-7 7" />
								</svg>
							)}
						</button>
					</div>
				</div>

				{/* ── Examples ── */}
				<div className="animate-stagger-up grid grid-cols-2 gap-2" style={{ animationDelay: "160ms" }}>
					{EXAMPLE_PROMPTS.map((prompt) => (
						<button
							key={prompt}
							type="button"
							onClick={() => {
								setValue(prompt);
								textareaRef.current?.focus();
							}}
							className="cursor-pointer truncate rounded-full border border-border/70 bg-surface/50 px-3.5 py-1.5 text-[12px] leading-none text-text-tertiary transition-all hover:border-border-light hover:bg-surface hover:text-text-secondary"
						>
							{prompt}
						</button>
					))}
				</div>

				{/* ── Agent Selection Cards ── */}
				<div className="animate-stagger-up" style={{ animationDelay: "240ms" }}>
					<div className="flex justify-center gap-3">
						{AGENT_DEFINITIONS.map((agent) => {
							const isSelected = selectedAgents.has(agent.id);
							const wouldGoBelow = isSelected && selectedAgents.size <= MIN_AGENTS;
							return (
								<button
									key={agent.id}
									type="button"
									onClick={() => toggleAgent(agent.id)}
									disabled={creating}
									className={`group flex w-40 cursor-pointer flex-col items-center gap-2 rounded-xl border px-4 py-3 text-center transition-all duration-200 ${
										isSelected
											? "border-border-light bg-surface shadow-elevated"
											: "border-border/50 bg-transparent hover:border-border hover:bg-surface/30"
									} ${wouldGoBelow ? "cursor-not-allowed" : ""} disabled:opacity-50`}
									title={wouldGoBelow ? `Cannot deselect — minimum ${MIN_AGENTS} agents required` : agent.description}
								>
									{/* Agent dot + label */}
									<div className="flex items-center gap-2">
										<span
											className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
											style={{
												backgroundColor: agent.color,
												opacity: isSelected ? 1 : 0.4,
											}}
										/>
										<span
											className="text-[13px] font-medium transition-colors"
											style={{ color: isSelected ? agent.color : "var(--color-text-tertiary)" }}
										>
											{agent.shortLabel}
										</span>
									</div>

									{/* Description */}
									<span className="text-[10px] leading-[1.4] text-text-quaternary line-clamp-2">
										{agent.description.split(".")[0]}
									</span>
								</button>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
