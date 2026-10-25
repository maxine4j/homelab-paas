import type { WorkerDeploymentRequest } from "../../deployment/types.ts";

export type WorkerReconciliationRequest = Omit<WorkerDeploymentRequest, "spec">;
