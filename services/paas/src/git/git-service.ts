// Service layer
// Responsible for higher level git workflows like fetching a specific file from a specific remote
// Depends on the GitClient for all interactions
// Hides details like tmp directories and repositories on disk from the caller
export interface GitService {
	// fetchFile()
}
