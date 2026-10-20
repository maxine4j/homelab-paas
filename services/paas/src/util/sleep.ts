import { setTimeout } from "node:timers/promises";

export interface ISleep {
	(delayMs: number): Promise<void>;
}
export const sleep: ISleep = async (delayMs: number) => {
	await setTimeout(delayMs);
};
