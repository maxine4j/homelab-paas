
export interface UserAuthorizationChecker {
  (username: string, serviceAuthorizedUsernames: string[] | undefined): boolean
}

export const createUserAuthorizationChecker = (
  paasAuthorizedUsernames: string[],
): UserAuthorizationChecker => {

  return (username: string, serviceAuthorizedUsernames: string[] | undefined): boolean => {
    // user must be authorized to access the paas regardless of service auth
    if (!paasAuthorizedUsernames.includes(username)) {
      return false;
    }
    
    // if the service does not define a list of authorized users, then any paas user can access the service
    if (serviceAuthorizedUsernames === undefined) {
      return true;
    }

    // if the service does define a list of authorized users, only allow those users access
    return serviceAuthorizedUsernames.includes(username);
  }
}
