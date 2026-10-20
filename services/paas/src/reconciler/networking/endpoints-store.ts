import { InMemoryKeyValueStore } from "../../store/in-memory-store.ts";
import type { Endpoint } from "./types.ts";

export type RoutesStore = InMemoryKeyValueStore<Endpoint>;
export class InMemoryRoutesStore extends InMemoryKeyValueStore<Endpoint> {}
