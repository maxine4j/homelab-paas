import { AuthService } from './service';

describe('user authorization service', () => {

  test('should deny user who is not in paas users, even if they are present in service users', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = ['user-service'];

    const authService = new AuthService(null as any, '', 0, paasAuthorizedUsernames);

    expect(authService.isUserAuthorized('user-service', serviceAuthorizedUsernames)).toBe(false);
  });

  test('should deny user who is not in service users, even if they are present in paas users', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = ['user-service'];

    const authService = new AuthService(null as any, '', 0, paasAuthorizedUsernames);

    expect(authService.isUserAuthorized('user-paas', serviceAuthorizedUsernames)).toBe(false);
  });

  test('should allow user who is present in both paas and service users', () => {
    const paasAuthorizedUsernames = ['user-both'];
    const serviceAuthorizedUsernames = ['user-both'];

    const authService = new AuthService(null as any, '', 0, paasAuthorizedUsernames);

    expect(authService.isUserAuthorized('user-both', serviceAuthorizedUsernames)).toBe(true);
  });

  test('should allow paas user is there is no authorization list defined for the service', () => {
    const paasAuthorizedUsernames = ['user-paas'];
    const serviceAuthorizedUsernames = undefined;

    const authService = new AuthService(null as any, '', 0, paasAuthorizedUsernames);

    expect(authService.isUserAuthorized('user-paas', serviceAuthorizedUsernames)).toBe(true);
  });

});
