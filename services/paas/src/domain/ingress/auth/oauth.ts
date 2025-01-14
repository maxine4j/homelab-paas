import jwt from 'jsonwebtoken';
import { config } from '../../../util/config';
import { logger } from '../../../util/logger';

interface AuthedUserDetails {
  username: string
  name: string
  email: string | undefined
  avatarUrl: string
}

export const getLoginUrl = (finalRedirectUri: string) => {
  const redirectUri = `https://${config.rootDomain}/auth/callback?redirect_uri=${encodeURI(finalRedirectUri)}`;
  return `https://github.com/login/oauth/authorize?response_type=code&client_id=${config.auth.clientId}&redirect_uri=${encodeURI(redirectUri)}&scope=${encodeURI('user:email')}`;
};

export const authorizeUser = async (code: string) => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      'client_id': config.auth.clientId,
      'client_secret': config.auth.clientSecret,
      'code': code,
    }),
  });
  const responseBody = await response.json();
  const accessToken = responseBody['access_token'];
  logger.info({ status: response.status }, 'Fetched access token from github');

  const userDetails = await fetchUserDetails(accessToken);
  return issueJwt(userDetails);
};

const fetchUserDetails = async (accessToken: string): Promise<AuthedUserDetails> => {
  const [user, email] = await Promise.all([
    fetchGithubUser(accessToken),
    fetchUserEmail(accessToken),
  ]);

  return {
    ...user,
    email,
  };
}

const fetchGithubUser = async (accessToken: string) => {
  const response = await fetch('https://api.github.com/user', {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const responseBody = await response.json();
  logger.info({ status: response.status }, 'Fetched user details from github');

  return {
    username: responseBody['login'],
    name: responseBody['name'],
    avatarUrl: responseBody['avatar_url'],
  };
};

const fetchUserEmail = async (accessToken: string) => {
  const response = await fetch('https://api.github.com/user/emails', {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const responseBody = await response.json() as Array<{ email: string, primary: boolean }>;
  logger.info({ status: response.status }, 'Fetched user emails from github');
  
  return responseBody.find(emailResponse => emailResponse.primary)?.email;
}

const issueJwt = async (userDetails: AuthedUserDetails) => {
  return jwt.sign(userDetails, config.auth.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.auth.sessionLifetimeSeconds,
  });
};

export const verifyAuthCookie = async (cookies: { get: (cookieName: string) => string | undefined }): Promise<AuthedUserDetails | undefined> => {
  const authCookie = cookies.get(config.auth.cookieName);

  if (!authCookie) {
    return undefined;
  }

  try {
    const payload = jwt.verify(authCookie, config.auth.jwtSecret, {
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string') {
      return undefined;
    }
    logger.info({ payload, typeOfPayload: typeof payload }, 'verified jwt');
    return undefined; // JSON.parse(payload as any as string) as AuthedUserDetails;
  } catch {
    return undefined;
  }
};
