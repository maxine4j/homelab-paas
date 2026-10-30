export interface Endpoint {
	address: string;
	port: number;
	healthcheckPath?: string | null;
	public: boolean;
	/** Resource-scoped routes may also receive the service hostname. Legacy routes omit this. */
	primary?: boolean;
}
