/** Draft CP-05 model, preserved during migration. The proposal is not approved. */
export interface Descriptor {
  version: 1;
  metadata: {
    serviceId: string;
    name?: string;
    description?: string;
    labels: Record<string, string>;
  };
  resources: Record<string, Resource>;
}
export type EnvValue = { value: string } | { secretRef: string };
export type ConfigFile = { content: string } | { secretRef: string };
export interface Requests {
  cpuMillis: number;
  memoryMiB: number;
}
export interface Limits {
  cpuMillis: number;
  memoryMiB: number;
}
export type Check =
  | { type: "http"; path: string }
  | { type: "tcp" }
  | { type: "exec"; command: string[] };
export type Healthcheck = Check & {
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
};
export type Storage = (
  | { type: "ephemeral" | "data" | "persistent" }
  | { type: "alias"; alias: string }
) & { mountPath: string; readOnly: boolean };
export interface Workload {
  image: string;
  command: string[];
  args: string[];
  env: Record<string, EnvValue>;
  configFiles: Record<string, ConfigFile>;
  requests: Requests;
  limits: Limits;
  shutdownGraceSeconds: number;
  healthcheck?: Healthcheck;
  storage: Record<string, Storage>;
}
export type Web = Workload & { type: "web"; port: number; public: boolean; primary?: boolean };
export type Worker = Workload & { type: "worker" };
export type Resource = Web | Worker;
export interface ValidationContext {
  clusterDomain: string;
  occupiedHosts: Set<string>;
  reservedServiceIds: Set<string>;
  reservedPaths: Set<string>;
  applicationSecrets: Map<string, Set<string>>;
  /** Resource → alias → write authorization, supplied only by a trusted caller. */
  aliases: Map<string, Map<string, boolean>>;
}
export type DescriptorCode =
  | "invalid_yaml"
  | "unsupported_version"
  | "unsupported_resource_type"
  | "invalid_value"
  | "capacity"
  | "unresolved_reference"
  | "collision"
  | "invalid_primary";
export class DescriptorError extends Error {
  readonly file = "descriptor";
  readonly path = "resources";
  readonly code: DescriptorCode = "invalid_value";
  readonly line = null;
  readonly column = null;
  constructor() {
    super("descriptor:resources: invalid_value");
    this.name = "DescriptorError";
  }
}

// The pre-migration implementation was a rejecting stub. Do not turn the draft
// proposal into accepted product behavior as part of a language migration.
export function parseDescriptor(
  _file: string,
  _yaml: string,
  _context: ValidationContext,
): Descriptor {
  throw new DescriptorError();
}
