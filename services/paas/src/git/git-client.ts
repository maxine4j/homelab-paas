// Client layer
// Responsible for interacting with git repositories on disk and their configured remotes
// Exposes lower level functionality like clone and pull via a convinient typescript api
// Wraps third party library types and prevents them from leaking up into the service layer (including wrapping all errors)
export interface GitClient {
	// cloneRepo()
	// fetchFile()
}
