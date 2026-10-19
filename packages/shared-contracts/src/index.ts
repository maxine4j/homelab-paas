/** A host-managed credential name, never a resolved credential value. */
export type CredentialReference = string;

export interface ApiError {
	code: "invalid_request" | "not_found";
	diagnostics: { path: string; code: "required" }[];
}
