export interface Endpoint {
	address: string;
	port: number;
	healthcheckPath: string;
	public: boolean;
}
