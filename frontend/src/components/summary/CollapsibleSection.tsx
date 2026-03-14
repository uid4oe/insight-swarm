import { useState } from "react";

interface Props {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	children: React.ReactNode;
}

export function CollapsibleSection({ title, count, defaultOpen = true, children }: Props) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent py-1 text-left"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					className={`shrink-0 text-text-quaternary transition-transform duration-200 ${open ? "rotate-90" : ""}`}
				>
					<title>Expand section</title>
					<path
						d="M4 2.5L8 6L4 9.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className="text-section-header">{title}</span>
				{count != null && count > 0 && <span className="text-meta text-text-quaternary">{count}</span>}
			</button>

			<div className={`${open ? "collapse-grid-open" : "collapse-grid"}`}>
				<div className="overflow-hidden">
					<div className="pt-1.5">{children}</div>
				</div>
			</div>
		</div>
	);
}
