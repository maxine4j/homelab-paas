import { expect, test } from "vitest";

import { ChangeBus } from "./change-bus.ts";

test("isolates failing subscribers and removes subscriptions", () => {
	const bus = new ChangeBus();
	const received: unknown[] = [];
	bus.subscribe(() => {
		throw new Error("subscriber failed");
	});
	const stop = bus.subscribe((event) => received.push(event));
	bus.publish({ serviceId: "demo" });
	stop();
	bus.publish({});
	expect(received).toEqual([{ serviceId: "demo" }]);
});
