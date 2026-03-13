import { useCallback, useEffect, useRef, useState } from "react";
import { askFollowup } from "../../lib/api";

interface Message {
	role: "user" | "assistant";
	content: string;
}

interface Props {
	taskId: string;
}

type InlineNode = string | React.ReactElement;

/** Parse inline markdown (bold, italic, code) into React elements. */
function parseInline(text: string): InlineNode[] {
	const nodes: InlineNode[] = [];
	const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
	let lastIndex = 0;

	for (const match of text.matchAll(regex)) {
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index));
		}
		if (match[2]) {
			nodes.push(<strong key={match.index}>{match[2]}</strong>);
		} else if (match[3]) {
			nodes.push(<em key={match.index}>{match[3]}</em>);
		} else if (match[4]) {
			nodes.push(
				<code key={match.index} className="rounded-sm bg-surface px-1 py-0.5 text-[12px]">
					{match[4]}
				</code>,
			);
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex));
	}
	return nodes;
}

function MarkdownText({ text }: { text: string }) {
	const lines = text.split("\n").filter((line) => line.trim());
	return (
		<div className="space-y-2">
			{lines.map((line, i) => (
				<p key={`${i}-${line.slice(0, 30)}`} className="leading-relaxed">
					{parseInline(line)}
				</p>
			))}
		</div>
	);
}

export function FollowupChat({ taskId }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);

	const scrollToBottom = useCallback(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: messages and loading used as scroll triggers
	useEffect(() => {
		scrollToBottom();
	}, [messages, loading, scrollToBottom]);

	const handleSubmit = async (e?: React.FormEvent) => {
		e?.preventDefault();
		const question = input.trim();
		if (!question || loading) return;

		setInput("");
		setMessages((prev) => [...prev, { role: "user", content: question }]);
		setLoading(true);

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const { answer } = await askFollowup(taskId, question, controller.signal);
			setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			setMessages((prev) => [
				...prev,
				{ role: "assistant", content: "Sorry, I couldn't generate an answer. Please try again." },
			]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		return () => abortRef.current?.abort();
	}, []);

	return (
		<div className="flex flex-col border-t border-border">
			{/* Messages area */}
			{messages.length > 0 && (
				<div ref={scrollRef} className="scrollbar-thin max-h-[320px] overflow-y-auto px-5 pt-4 pb-2">
					<div className="space-y-4">
						{messages.map((msg, i) => (
							<div key={`${msg.role}-${i}`}>
								{msg.role === "user" ? (
									<div className="flex justify-end">
										<div className="max-w-[85%] rounded-md rounded-br-sm bg-surface px-3.5 py-2.5 text-[13px] text-text-primary">
											{msg.content}
										</div>
									</div>
								) : (
									<div className="text-[13px] text-text-secondary leading-relaxed">
										<MarkdownText text={msg.content} />
									</div>
								)}
							</div>
						))}
						{loading && (
							<div className="flex items-center gap-2 text-[13px] text-muted">
								<span className="spinner" />
								Thinking...
							</div>
						)}
					</div>
				</div>
			)}

			{/* Gemini-style input bar */}
			<form onSubmit={handleSubmit} className="px-4 py-3">
				<div className="flex items-end gap-3 rounded-2xl border border-border/70 bg-surface/30 px-4 py-3 transition-all focus-within:border-accent/30 focus-within:bg-surface/50">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSubmit();
							}
						}}
						placeholder="Ask a follow-up question about this insight..."
						disabled={loading}
						rows={1}
						className="min-h-[20px] max-h-[80px] flex-1 resize-none bg-transparent text-[13px] text-text-primary placeholder:text-dim focus:outline-none"
					/>
					<button
						type="submit"
						disabled={!input.trim() || loading}
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-gradient transition-all disabled:opacity-25"
						aria-label="Send"
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
							<title>Send</title>
							<path d="M5 12h14M12 5l7 7-7 7" />
						</svg>
					</button>
				</div>
			</form>
		</div>
	);
}
