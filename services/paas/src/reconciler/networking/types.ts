export interface Endpoint {
	address: string;
	port: number;
	healthcheckPath: string;
	public: boolean;
	/** Resource-scoped routes may also receive the service hostname. Legacy routes omit this. */
	primary?: boolean;
}
