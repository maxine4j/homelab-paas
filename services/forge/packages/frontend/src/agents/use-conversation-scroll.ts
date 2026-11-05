import type { AgentView } from "@homelab-paas/forge-contracts/agents";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

export const useConversationScroll = (view: AgentView | undefined, selected: boolean) => {
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const [paused, setPaused] = useState(false);
	const [pending, setPending] = useState(false);
	const [pulse, setPulse] = useState(0);
	const lastPulse = useRef(-Infinity);
	const baseline = useRef<string | undefined>(undefined);
	const position = useRef(0);
	const anchors = useRef<{ id: string; offset: number }[]>([]);
	const geometry = useRef({ height: 0, content: 0 });
	const visible = useCallback(
		() => selected && !!viewport.current?.clientHeight && !!viewport.current.getClientRects().length,
		[selected],
	);
	const entries = () => Array.from(content.current?.querySelectorAll<HTMLElement>("[data-scroll-id]") ?? []);
	const remember = useCallback(() => {
		const element = viewport.current;
		if (!element || !visible()) return;
		const top = element.getBoundingClientRect().top;
		const bottom = top + element.clientHeight;
		anchors.current = entries()
			.filter((entry) => entry.getBoundingClientRect().bottom > top && entry.getBoundingClientRect().top < bottom)
			.map((entry) => ({ id: entry.dataset["scrollId"]!, offset: entry.getBoundingClientRect().top - top }));
		position.current = element.scrollTop;
		geometry.current = { height: element.clientHeight, content: element.scrollHeight };
	}, [visible]);
	const correct = useCallback(() => {
		const element = viewport.current;
		if (!element || !visible()) return;
		if (following.current) element.scrollTop = element.scrollHeight;
		else {
			const nodes = entries();
			const anchor = anchors.current.find((saved) => nodes.some((node) => node.dataset["scrollId"] === saved.id));
			const node = anchor && nodes.find((entry) => entry.dataset["scrollId"] === anchor.id);
			element.scrollTop =
				node && anchor
					? element.scrollTop
						+ node.getBoundingClientRect().top
						- element.getBoundingClientRect().top
						- anchor.offset
					: position.current;
		}
		remember();
	}, [remember, visible]);
	const resume = () => {
		following.current = true;
		setPaused(false);
		setPending(false);
		setPulse(0);
		lastPulse.current = -Infinity;
		correct();
	};
	const onScroll = () => {
		const element = viewport.current;
		if (!element || !visible() || Math.abs(element.scrollTop - position.current) < 1) return;
		// Geometry corrections and browser clamping are not reading gestures.
		if (geometry.current.height !== element.clientHeight || geometry.current.content !== element.scrollHeight)
			return;
		if (element.scrollHeight - element.clientHeight - element.scrollTop <= 8) resume();
		else {
			following.current = false;
			setPaused(true);
			remember();
		}
	};
	const onWheel = (event: { deltaY: number }) => {
		if (event.deltaY >= 0 || !visible() || !viewport.current?.scrollTop) return;
		// Pause before a concurrent snapshot can move the bottom under this gesture.
		following.current = false;
		setPaused(true);
		remember();
	};
	useLayoutEffect(() => {
		if (view) {
			const signature = JSON.stringify([view.items, view.requests]);
			if (baseline.current !== undefined && signature !== baseline.current && !following.current) {
				setPending(true);
				if (visible() && performance.now() - lastPulse.current >= 800) {
					lastPulse.current = performance.now();
					setPulse((value) => value + 1);
				}
			}
			baseline.current = signature;
		}
		correct();
	}, [view, correct, visible]);
	useLayoutEffect(() => {
		const observer = new ResizeObserver(correct);
		if (viewport.current) observer.observe(viewport.current);
		if (content.current) observer.observe(content.current);
		return () => observer.disconnect();
	}, [correct]);
	return { viewport, content, paused, pending, pulse, onScroll, onWheel, resume };
};
