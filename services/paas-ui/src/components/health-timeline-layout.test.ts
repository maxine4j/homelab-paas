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

test("merges transitive neighbours while preserving sorted colour runs and leaving inputs untouched", () => {
	const markers = [marker(160), marker(100), marker(130, "Progressing"), marker(101)];
	const [cluster] = layoutHealthMarkers(markers, 0, 1000, 1000);
	expect(cluster?.runs.map((run) => run.map(({ timestamp }) => timestamp))).toEqual([[100, 101], [130], [160]]);
	expect(markers.map(({ timestamp }) => timestamp)).toEqual([160, 100, 130, 101]);
});

test("merges again when a growing pill would crowd an earlier marker", () => {
	// The first pair has 18px of clear space until the right group expands into a pill.
	const clusters = layoutHealthMarkers([marker(100), marker(136, "Progressing"), marker(137)], 0, 1000, 1000);
	expect(clusters).toHaveLength(1);
	expect(clusters[0]?.runs).toHaveLength(3);
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

test("bounds very dense alternating pills to the track width", () => {
	const markers = Array.from({ length: 40 }, (_, index) =>
		marker(500 + index, index % 2 ? "Progressing" : "Degraded"),
	);
	const [cluster] = layoutHealthMarkers(markers, 0, 1000, 240);
	expect(cluster?.runs).toHaveLength(40);
	expect(cluster!.left + cluster!.width).toBeLessThanOrEqual(240);
});
