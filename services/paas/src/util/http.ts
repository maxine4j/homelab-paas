export const parseBearerToken = (
  authorizationHeader: string | undefined,
): string | undefined => {
  const prefix = 'Bearer ';

  if (!authorizationHeader) {
    return undefined;
  }

  if (!authorizationHeader.startsWith(prefix)) {
    return undefined;
  }

  return authorizationHeader.substring(prefix.length);
};
