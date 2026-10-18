import { setTimeout } from "node:timers/promises";

export const sleep = async (delayMs: number) => {
    await setTimeout(delayMs);
}
