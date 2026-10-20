export type ResourceType = "web" | "worker" | "postgres" | "rabbitmq";
export type ResourceLifecycle = "eternal" | "service" | "deployment";

export interface ResourceReconciler {
	type: ResourceType;
	lifecycle: ResourceLifecycle;
	reconcile(): Promise<void>;
}
