import { createUserAuthorizationChecker } from './authz';

describe('user authorization handler', () => {

  test('should deny user who is not in paas users, even if they are present in service users', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = ['user-service'];

    const isUserAuthorized = createUserAuthorizationChecker(paasAuthorizedUsernames);

    expect(isUserAuthorized('user-service', serviceAuthorizedUsernames)).toBe(false);
  });

  test('should deny user who is not in service users, even if they are present in paas users', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = ['user-service'];

    const isUserAuthorized = createUserAuthorizationChecker(paasAuthorizedUsernames);

    expect(isUserAuthorized('user-paas', serviceAuthorizedUsernames)).toBe(false);
  });

  test('should allow user who is present in both paas and service users', () => {
    const paasAuthorizedUsernames = ['user-both'];
    const serviceAuthorizedUsernames = ['user-both'];

    const isUserAuthorized = createUserAuthorizationChecker(paasAuthorizedUsernames);

    expect(isUserAuthorized('user-both', serviceAuthorizedUsernames)).toBe(true);
  });

  test('should allow paas user is there is no authorization list defined for the service', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = undefined;

    const isUserAuthorized = createUserAuthorizationChecker(paasAuthorizedUsernames);

    expect(isUserAuthorized('user-paas', serviceAuthorizedUsernames)).toBe(true);
  });

});
