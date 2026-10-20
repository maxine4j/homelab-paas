import fs from "fs/promises";

export type FileWriter = (path: string, data: string) => Promise<void>;
export const writeFile: FileWriter = async (name: string, data: string) => {
	await fs.writeFile(name, data);
};

export type FileReader = (path: string) => Promise<string | undefined>;
export const readFile: FileReader = async (path: string) => {
	try {
		return await fs.readFile(path, "utf-8");
	} catch {
		return undefined;
	}
};
