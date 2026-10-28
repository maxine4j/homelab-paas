import { StringDecoder } from "node:string_decoder";

import { DockerClientError } from "./errors.ts";

/** Incremental Docker framing and UTF-8 decoding shared by completed tails and follows. */
export class DockerLogDecoder {
	private readonly decoder = new StringDecoder("utf8");
	private pending = Buffer.alloc(0);
	private framed: boolean | undefined;
	constructor(private readonly maxFrameBytes: number) {}
	push(chunk: Uint8Array): string {
		if (chunk.byteLength > this.maxFrameBytes) throw new DockerClientError("invalid-response");
		this.pending = Buffer.concat([this.pending, chunk]);
		if (this.framed === undefined && this.pending.length)
			this.framed = this.pending[0] === 1 || this.pending[0] === 2;
		if (!this.framed) {
			const text = this.decoder.write(this.pending);
			this.pending = Buffer.alloc(0);
			return text;
		}
		let text = "";
		while (this.pending.length >= 8) {
			if (![1, 2].includes(this.pending[0]!) || this.pending.subarray(1, 4).some((byte) => byte !== 0))
				throw new DockerClientError("invalid-response");
			const size = this.pending.readUInt32BE(4);
			if (size > this.maxFrameBytes) throw new DockerClientError("invalid-response");
			if (this.pending.length < size + 8) break;
			text += this.decoder.write(this.pending.subarray(8, size + 8));
			this.pending = this.pending.subarray(size + 8);
		}
		return text;
	}
	end(): string {
		if (this.pending.length) throw new DockerClientError("invalid-response");
		return this.decoder.end();
	}
}
