export interface Endpoint {
	/** Uses the control-plane static listener instead of a workload container. */
	static?: boolean;
	address: string;
	port: number;
	healthcheckPath?: string | null;
	public: boolean;
	/** Resource-scoped routes may also receive the service hostname. Legacy routes omit this. */
	primary?: boolean;
}
