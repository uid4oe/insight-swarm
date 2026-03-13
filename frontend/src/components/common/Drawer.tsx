import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

interface DrawerProps {
	onClose: () => void;
	width?: string;
	children: ReactNode;
	/** Optional hero header rendered above the scrollable content.
	 *  Gets a sticky collapse effect as the user scrolls. */
	hero?: ReactNode;
	/** Accent color used for subtle glow effects. */
	accent?: string;
}

/**
 * Slide-in drawer from the right.
 * Now supports an optional `hero` slot that renders a full-bleed header
 * with parallax-style scroll behavior.
 */
export function Drawer({ onClose, width = "580px", children, hero, accent }: DrawerProps) {
	const [exiting, setExiting] = useState(false);
	const [scrolled, setScrolled] = useState(false);
	const contentRef = useRef<HTMLElement>(null);

	const handleClose = useCallback(() => {
		if (!exiting) setExiting(true);
	}, [exiting]);

	const handleAnimationEnd = useCallback(() => {
		if (exiting) onClose();
	}, [exiting, onClose]);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const onScroll = () => setScrolled(el.scrollTop > 12);
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, []);

	// Focus trap
	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab") return;
			const focusable = el.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		el.addEventListener("keydown", handleKeyDown);
		const first = el.querySelector<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
		);
		first?.focus();
		return () => el.removeEventListener("keydown", handleKeyDown);
	}, []);

	const glowColor = accent ?? "var(--color-accent)";

	return (
		<dialog
			open
			className={`backdrop-overlay ${exiting ? "animate-backdrop-exit" : "animate-backdrop-enter"} p-0 m-0 border-none w-full h-full max-w-full max-h-full block`}
			onClick={(e) => {
				if (e.target === e.currentTarget) handleClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") handleClose();
			}}
		>
			<section
				ref={contentRef}
				className={`scrollbar-thin relative flex h-screen cursor-default flex-col overflow-y-auto rounded-l-2xl border-l border-border/50 bg-[#12121a]/95 backdrop-blur-xl shadow-[--shadow-popup] ml-auto ${
					exiting ? "animate-drawer-exit" : "animate-drawer-enter"
				}`}
				style={{ width, maxWidth: "90vw" }}
				onAnimationEnd={handleAnimationEnd}
				role="document"
			>
				{/* ── Ambient glow ───────────────────────────────── */}
				<div
					className="pointer-events-none absolute inset-x-0 top-0 h-48 opacity-[0.08]"
					style={{
						background: `radial-gradient(ellipse 80% 100% at 50% -30%, ${glowColor}, transparent)`,
					}}
				/>

				{/* ── Close button (always visible, floats top-right) ── */}
				<button
					type="button"
					className={`sticky top-0 z-20 ml-auto mr-4 mt-4 mb-[-48px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[14px] transition-all duration-200 ${
						scrolled
							? "border-border/80 bg-surface-elevated/90 text-text-tertiary backdrop-blur-md shadow-sm hover:bg-surface-hover hover:text-text-primary"
							: "border-border/40 bg-transparent text-text-quaternary hover:bg-surface/60 hover:text-text-secondary"
					}`}
					onClick={handleClose}
					aria-label="Close drawer"
				>
					&times;
				</button>

				{/* ── Hero header (optional) ─────────────────────── */}
				{hero && <div className="relative z-[1] shrink-0">{hero}</div>}

				{/* ── Scrollable content ─────────────────────────── */}
				<div className="relative z-[1] flex-1 px-6 pb-12 pt-2">{children}</div>
			</section>
		</dialog>
	);
}
