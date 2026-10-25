import type { IncomingHttpHeaders } from "node:http";

export interface CapturedRequest {
	method: string;
	url: URL;
	headers: IncomingHttpHeaders;
	body: string;
}
export type MockHandler = (request: CapturedRequest) => Response | undefined | Promise<Response | undefined>;
