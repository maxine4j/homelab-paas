import { expect, test } from "vitest";

import type { HealthTimelineMarker } from "../types.ts";
import { layoutHealthMarkers } from "./health-timeline-layout.ts";

const marker = (timestamp: number, health: HealthTimelineMarker["health"] = "Degraded"): HealthTimelineMarker => ({
	timestamp,
	health,
});

test("keeps exactly one diameter of free space and clusters any smaller gap", () => {
	const separate = layoutHealthMarkers([marker(100), marker(136)], 0, 1000, 1000);
	expect(separate).toHaveLength(2);
	expect(separate[1]!.left - separate[0]!.left - separate[0]!.width).toBe(18);
	expect(layoutHealthMarkers([marker(100), marker(135.99)], 0, 1000, 1000)).toHaveLength(1);
});

test("recomputes grouping with the actual width after resizing", () => {
	const markers = [marker(100), marker(160, "Progressing")];
	expect(layoutHealthMarkers(markers, 0, 1000, 1000)).toHaveLength(2);
	expect(layoutHealthMarkers(markers, 0, 1000, 400)).toHaveLength(1);
});

test("merges transitive neighbours by first colour appearance without reordering inputs", () => {
	const markers = [marker(160), marker(100), marker(130, "Progressing"), marker(101)];
	const [cluster] = layoutHealthMarkers(markers, 0, 1000, 1000);
	expect(cluster?.groups.map((group) => group.map(({ timestamp }) => timestamp))).toEqual([[100, 101, 160], [130]]);
	expect(markers.map(({ timestamp }) => timestamp)).toEqual([160, 100, 130, 101]);
});

test("merges again when a growing pill would crowd an earlier marker", () => {
	// The first pair has 18px of clear space until the right group expands into a pill.
	const clusters = layoutHealthMarkers([marker(100), marker(136, "Progressing"), marker(137)], 0, 1000, 1000);
	expect(clusters).toHaveLength(1);
	expect(clusters[0]?.groups).toHaveLength(2);
});

test("joins a stray dot to the closer of two pills and preserves the gap between them", () => {
	const markers = [100, 101, 140, 175, 176].map((timestamp) => marker(timestamp));
	const [left, right] = layoutHealthMarkers(markers, 0, 1000, 1000);
	expect(left?.markers.map(({ timestamp }) => timestamp)).toEqual([100, 101]);
	expect(right?.markers.map(({ timestamp }) => timestamp)).toEqual([140, 175, 176]);
	expect(right!.left - (left!.left + left!.width)).toBeGreaterThanOrEqual(18);
});

test("keeps edge circles and pills inside the track and checks their clamped spacing", () => {
	const clusters = layoutHealthMarkers([marker(0), marker(37), marker(1000)], 0, 1000, 1000);
	expect(clusters).toHaveLength(2);
	for (const cluster of clusters) {
		expect(cluster.left).toBeGreaterThanOrEqual(0);
		expect(cluster.left + cluster.width).toBeLessThanOrEqual(1000);
	}
	expect(clusters[0]?.markers).toHaveLength(2);
});

test("fits every distinct colour on a narrow track and retains all occurrences", () => {
	const colours = ["Progressing", "Degraded", "Healthy", "Paused", "Missing", "Unknown"] as const;
	const markers = [...colours, ...colours].map((health, index) => marker(500 + index, health));
	const clusters = layoutHealthMarkers(markers, 0, 1000, 100);
	expect(clusters).toHaveLength(1);
	const cluster = clusters[0]!;
	expect(cluster.groups.map((group) => group.map(({ health }) => health))).toEqual(
		colours.map((health) => [health, health]),
	);
	expect(cluster.left).toBe(0);
	expect(cluster.width).toBe(100);
	expect(cluster.markerScale).toBeCloseTo(0.625);
});
