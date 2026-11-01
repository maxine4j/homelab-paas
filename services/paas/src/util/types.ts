/** Only validated identities and fixed decisions belong in authorization request outcomes. */
export interface AuthorizationLogFields {
	targetHost?: string;
	serviceId?: string;
	targetId?: string;
	authReason:
		| "unknown-host"
		| "endpoint-missing"
		| "login-required"
		| "invalid-path"
		| "allowed"
		| "authorization-error";
}
