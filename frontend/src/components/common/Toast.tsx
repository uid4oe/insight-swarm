import { useEffect, useState } from "react";

interface ToastMessage {
	id: number;
	text: string;
	type: "success" | "error" | "info";
}

let toastId = 0;
const listeners = new Set<(t: ToastMessage) => void>();

export function showToast(text: string, type: ToastMessage["type"] = "info") {
	const msg: ToastMessage = { id: ++toastId, text, type };
	for (const fn of listeners) fn(msg);
}

const TYPE_STYLES = {
	success: "toast-success",
	error: "toast-error",
	info: "toast-info",
} as const;

export function ToastContainer() {
	const [toasts, setToasts] = useState<ToastMessage[]>([]);

	useEffect(() => {
		const handler = (t: ToastMessage) => {
			setToasts((prev) => [...prev, t]);
			setTimeout(() => {
				setToasts((prev) => prev.filter((x) => x.id !== t.id));
			}, 4000);
		};
		listeners.add(handler);
		return () => {
			listeners.delete(handler);
		};
	}, []);

	const dismiss = (id: number) => {
		setToasts((prev) => prev.filter((x) => x.id !== id));
	};

	if (toasts.length === 0) return null;

	return (
		<div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3">
			{toasts.slice(-3).map((t) => (
				<div
					key={t.id}
					className={`group animate-slide-up flex items-center gap-3 rounded-lg border px-5 py-3.5 font-sans text-[13px] shadow-[--shadow-elevated] backdrop-blur-md ${TYPE_STYLES[t.type]}`}
				>
					<span className="flex-1">{t.text}</span>
					<button
						type="button"
						onClick={() => dismiss(t.id)}
						className="cursor-pointer border-none bg-transparent p-0 text-current opacity-0 transition-opacity group-hover:opacity-50 hover:!opacity-100"
						aria-label="Dismiss"
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
