import type { ApiError, CredentialReference } from "@homelab-paas/shared-contracts";

// Browser compiler fixtures exercise the same workspace boundary as the backend.
const reference: CredentialReference = "github-read";
const missing: ApiError = { code: "not_found", diagnostics: [] };
// @ts-expect-error Error codes are closed.
const unknownCode: ApiError = { code: "unknown", diagnostics: [] };
// @ts-expect-error Resolved credentials are absent from public contracts.
const secret: ApiError = { code: "not_found", diagnostics: [], secret: "value" };
void [reference, missing, unknownCode, secret];
