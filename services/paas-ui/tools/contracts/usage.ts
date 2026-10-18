import type { ApiError, CredentialReference } from "../../generated/contracts";

// Compiler fixtures exercise the generated browser boundary.
const reference: CredentialReference = "github-personal-read";
const missing: ApiError = { code: "not_found", diagnostics: [] };
const invalid: ApiError = {
  code: "invalid_request",
  diagnostics: [{ path: "credentialRef", code: "required" }],
};
// @ts-expect-error Error codes are a closed set.
const unknownCode: ApiError = { code: "unknown", diagnostics: [] };
// @ts-expect-error Secret values are absent from the public contract.
const secret: ApiError = { code: "not_found", diagnostics: [], secret: "value" };
// @ts-expect-error References are strings, not resolved credentials.
const resolved: CredentialReference = { value: "secret" };
void [reference, missing, invalid, unknownCode, secret, resolved];
