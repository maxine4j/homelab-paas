export interface Certificate {
	key: string;
	cert: string;
}
export interface CertificateRequest {
	domains: string[];
	email: string;
}
