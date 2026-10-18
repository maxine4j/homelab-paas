import { Ajv } from "ajv";
import { schemas } from "./schemas.js";
import type { ApiError, CredentialReference } from "./generated/contracts.js";

export type { ApiError, CredentialReference } from "./generated/contracts.js";
export { schemas } from "./schemas.js";

const ajv = new Ajv({ strict: true, allErrors: true });
export const isApiError = ajv.compile<ApiError>(schemas.ApiError);
export const isCredentialReference = ajv.compile<CredentialReference>(schemas.CredentialReference);

export function credentialReference(value: unknown): CredentialReference {
  if (!isCredentialReference(value)) throw new TypeError("credential reference is required");
  return value;
}
