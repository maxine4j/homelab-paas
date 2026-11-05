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
		const colours = new Map<HealthTimelineMarker["health"], HealthTimelineMarker[]>();
		for (const marker of entries) {
			const group = colours.get(marker.health);
			if (group) group.push(marker);
			else colours.set(marker.health, [marker]);
		}
		const groups = [...colours.values()];
		const naturalWidth =
			entries.length === 1 ? diameter : groups.length * diameter + (groups.length - 1) * gap + padding * 2;
		const width = Math.min(trackWidth, naturalWidth);
		const middle = (((entries.at(0)!.timestamp + entries.at(-1)!.timestamp) / 2 - start) / duration) * trackWidth;
		return {
			left: Math.max(0, Math.min(trackWidth - width, middle - width / 2)),
			width,
			markerScale: width / naturalWidth,
			markers: entries,
			groups,
		};
	};
	const clusters = [...markers].sort((a, b) => a.timestamp - b.timestamp).map((marker) => place([marker]));
	while (true) {
		// Take the closest pair first so a dot between pills joins its nearer neighbour.
		let closest = -1;
		let clearSpace = diameter;
		for (let index = 0; index < clusters.length - 1; index++) {
			const left = clusters.at(index)!;
			const right = clusters.at(index + 1)!;
			const space = right.left - (left.left + left.width);
			if (space < clearSpace) {
				closest = index;
				clearSpace = space;
			}
		}
		if (closest === -1) return clusters;
		const left = clusters.at(closest)!;
		const right = clusters.at(closest + 1)!;
		clusters.splice(closest, 2, place([...left.markers, ...right.markers]));
	}
};
