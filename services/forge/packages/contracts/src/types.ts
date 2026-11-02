export interface CreateProject {
	name: string;
	source?: string;
}
export interface Project {
	id: string;
	name: string;
	status: "creating" | "ready" | "failed";
	createdAt: string;
}
