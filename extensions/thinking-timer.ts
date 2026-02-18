/**
 * Thinking Timer Extension
 *
 * Goal: show a live ticking timer *inline* on the collapsed "Thinking..." line,
 * so you see:
 *
 *   Thinking... 6.5s
 *
 * instead of having a second "Working..."/"Thinking ..." indicator line.
 *
 * Implementation notes:
 * - We track thinking_start/thinking_end stream events to measure durations.
 * - We monkey-patch AssistantMessageComponent.updateContent() to replace the
 *   hardcoded "Thinking..." label with "Thinking... <time>".
 * - This relies on internal rendering behavior (but uses exported components),
 *   so it may break if pi changes how it renders collapsed thinking blocks.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { AssistantMessageComponent } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

type Store = {
	/** Active thinking blocks: key -> start time (ms since epoch) */
	starts: Map<string, number>;
	/** Finalized thinking blocks: key -> duration ms */
	durations: Map<string, number>;
	/** Rendered label components for collapsed thinking blocks */
	labels: Map<string, Text>;
	/** Latest theme reference (ctx.ui.theme) */
	theme?: ExtensionContext["ui"]["theme"];
};

const STORE_KEY = Symbol.for("pi.extensions.thinkingTimer.store");
const PATCH_KEY = Symbol.for("pi.extensions.thinkingTimer.patch");

function getStore(): Store | undefined {
	return (globalThis as any)[STORE_KEY] as Store | undefined;
}

function formatElapsed(ms: number): string {
	const totalSeconds = ms / 1000;
	if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function makeThinkingLabel(theme: Store["theme"] | undefined, ms: number | null): string {
	if (!theme) {
		return ms === null ? "Thinking..." : `Thinking... ${formatElapsed(ms)}`;
	}
	if (ms === null) {
		return theme.italic(theme.fg("thinkingText", "Thinking..."));
	}
	const base = theme.fg("thinkingText", "Thinking...");
	const time = theme.fg("dim", ` ${formatElapsed(ms)}`);
	return theme.italic(base + time);
}

function keyFor(timestamp: number, contentIndex: number): string {
	return `${timestamp}:${contentIndex}`;
}

function ensureAssistantMessagePatchInstalled(): void {
	const proto: any = AssistantMessageComponent.prototype as any;
	if (proto[PATCH_KEY]) return;
	proto[PATCH_KEY] = true;

	const originalUpdateContent = proto.updateContent;

	proto.updateContent = function patchedUpdateContent(this: any, message: any) {
		originalUpdateContent.call(this, message);

		try {
			const store = getStore();
			if (!store) return;
			if (!message || !message.content || !Array.isArray(message.content)) return;
			if (!this.hideThinkingBlock) return;
			if (!this.contentContainer || !Array.isArray(this.contentContainer.children)) return;

			// Find thinking content indices that would produce a collapsed label.
			const thinkingIndices: number[] = [];
			for (let i = 0; i < message.content.length; i++) {
				const c = message.content[i];
				if (c?.type === "thinking" && typeof c.thinking === "string" && c.thinking.trim()) {
					thinkingIndices.push(i);
				}
			}
			if (thinkingIndices.length === 0) return;

			// Find the Text components that currently contain the hardcoded "Thinking..." label.
			const labelComponents: Text[] = [];
			for (const child of this.contentContainer.children as any[]) {
				// Be defensive: avoid relying on instanceof across module boundaries.
				if (!child || typeof child !== "object") continue;
				if (typeof child.setText !== "function") continue;
				if (typeof child.text !== "string") continue;
				if (!child.text.includes("Thinking...")) continue;
				labelComponents.push(child as Text);
			}
			if (labelComponents.length === 0) return;

			const count = Math.min(thinkingIndices.length, labelComponents.length);
			for (let j = 0; j < count; j++) {
				const contentIndex = thinkingIndices[j]!;
				const label = labelComponents[j]!;
				const k = keyFor(message.timestamp, contentIndex);
				store.labels.set(k, label);

				// Apply either live or finalized duration if we have it.
				let ms: number | null = null;
				const start = store.starts.get(k);
				const dur = store.durations.get(k);
				if (dur !== undefined) {
					ms = dur;
				} else if (start !== undefined) {
					ms = Date.now() - start;
				}

				// Only override label when we have timing info (or when live),
				// otherwise leave the original rendering alone.
				if (ms !== null) {
					label.setText(makeThinkingLabel(store.theme, ms));
				}
			}
		} catch {
			// Never break rendering
		}
	};
}

export default function (pi: ExtensionAPI) {
	// Shared store used by the patch (global so /reload replaces it cleanly)
	const store: Store = {
		starts: new Map(),
		durations: new Map(),
		labels: new Map(),
		theme: undefined,
	};
	(globalThis as any)[STORE_KEY] = store;
	ensureAssistantMessagePatchInstalled();

	let ticker: ReturnType<typeof setInterval> | null = null;

	function stopTicker() {
		if (ticker) {
			clearInterval(ticker);
			ticker = null;
		}
	}

	function tick() {
		const s = getStore();
		if (!s) return;
		if (s.starts.size === 0) {
			stopTicker();
			return;
		}
		for (const [k, start] of s.starts.entries()) {
			const label = s.labels.get(k);
			if (!label) continue;
			label.setText(makeThinkingLabel(s.theme, Date.now() - start));
		}
	}

	function startTicker() {
		if (ticker) return;
		ticker = setInterval(tick, 100);
	}

	function finalizeThinkingBlock(k: string, endTimeMs = Date.now()) {
		const s = getStore();
		if (!s) return;
		const start = s.starts.get(k);
		if (start === undefined) return;
		const dur = Math.max(0, endTimeMs - start);
		s.starts.delete(k);
		s.durations.set(k, dur);

		const label = s.labels.get(k);
		if (label) {
			label.setText(makeThinkingLabel(s.theme, dur));
		}
	}

	function resetAll(ctx: ExtensionContext) {
		stopTicker();
		store.starts.clear();
		store.durations.clear();
		store.labels.clear();
		store.theme = ctx.ui.theme;
		// Ensure we don't leave a custom working message around from earlier versions.
		ctx.ui.setWorkingMessage();
	}

	pi.on("session_start", async (_event, ctx) => {
		store.theme = ctx.ui.theme;
		ctx.ui.setWorkingMessage();
	});

	pi.on("message_update", async (event, ctx) => {
		store.theme = ctx.ui.theme;

		const se = event.assistantMessageEvent as any;
		if (!se || typeof se.type !== "string") return;

		if (se.type === "thinking_start" || se.type === "thinking_delta") {
			const msg = se.partial;
			const k = keyFor(msg.timestamp, se.contentIndex);
			if (!store.starts.has(k)) {
				store.starts.set(k, Date.now());
			}
			startTicker();
			// Try immediate paint if label already exists
			tick();
			return;
		}

		if (se.type === "thinking_end") {
			const msg = se.partial;
			const k = keyFor(msg.timestamp, se.contentIndex);
			finalizeThinkingBlock(k);
			if (store.starts.size === 0) stopTicker();
			return;
		}
	});

	// Safety: if a message ends while a thinking_start was seen but thinking_end was not,
	// finalize any active thinking blocks for that message.
	pi.on("message_end", async (event, ctx) => {
		store.theme = ctx.ui.theme;
		const msg: any = event.message;
		if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) return;

		for (let i = 0; i < msg.content.length; i++) {
			const c = msg.content[i];
			if (c?.type !== "thinking") continue;
			const k = keyFor(msg.timestamp, i);
			if (store.starts.has(k)) {
				finalizeThinkingBlock(k, Date.now());
			}
		}
		if (store.starts.size === 0) stopTicker();
	});

	pi.on("session_switch", async (_event, ctx) => {
		resetAll(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		resetAll(ctx);
	});
}
