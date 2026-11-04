import type { HealthTimelineCluster, HealthTimelineMarker } from "../types.ts";

// Includes the circle's outer ring; keep in sync with the track's CSS geometry.
const diameter = 18;
const gap = 8;
const padding = 6;

export const layoutHealthMarkers = (
	markers: HealthTimelineMarker[],
	start: number,
	duration: number,
	trackWidth: number,
): HealthTimelineCluster[] => {
	const place = (entries: HealthTimelineMarker[]): HealthTimelineCluster => {
		const runs: HealthTimelineMarker[][] = [];
		for (const marker of entries) {
			const last = runs.at(-1);
			if (last?.at(-1)?.health === marker.health) last.push(marker);
			else runs.push([marker]);
		}
		const width = Math.min(
			trackWidth,
			entries.length === 1 ? diameter : runs.length * diameter + (runs.length - 1) * gap + padding * 2,
		);
		const middle = (((entries.at(0)!.timestamp + entries.at(-1)!.timestamp) / 2 - start) / duration) * trackWidth;
		return { left: Math.max(0, Math.min(trackWidth - width, middle - width / 2)), width, markers: entries, runs };
	};
	const clusters: HealthTimelineCluster[] = [];
	for (const marker of [...markers].sort((a, b) => a.timestamp - b.timestamp)) {
		let cluster = place([marker]);
		// Expansion and edge clamping can bring an earlier cluster into range too.
		while (clusters.length) {
			const previous = clusters.at(-1)!;
			if (cluster.left - (previous.left + previous.width) >= diameter) break;
			clusters.pop();
			cluster = place([...previous.markers, ...cluster.markers]);
		}
		clusters.push(cluster);
	}
	return clusters;
};
