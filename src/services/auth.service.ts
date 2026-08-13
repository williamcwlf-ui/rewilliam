import { sign, verify } from 'jsonwebtoken';
import { updateStripeUser } from './stripe.service';
import { encrypt, generateSecureString } from './Crypto-service.service';
import { env } from '~/services/env';
import { getUserInfo, getUserThumbnail } from './roblox.service';
import { JWTUser } from '~/services/types/JWT.type';
import { RobloxOpenCloudUserInformation, RobloxOAuthAuthorizationExchangeResponse } from '~/services/types/roblox.opencloud.types';
import { readminCollections } from '~/services/mongo.service';
import { User } from './NewMongoTypes';
import { ensureUserIdentity } from './userIdentity.service';

export async function createSessionForRobloxUser(
  user: RobloxOpenCloudUserInformation,
  oauthInfo: RobloxOAuthAuthorizationExchangeResponse,
): Promise<[string, User]> {
  // Generate a secure token which is mathematically random to ensure the JWT can't be faked easily.
  const secureToken = await generateSecureString();

  let dbUser = await readminCollections.user.findOne({
    robloxId: user.sub.toString(),
  }) as User;


  if (!dbUser) {
    const inserted = await readminCollections.user.insertOne({
      robloxId: user.sub.toString(),
      role: 'User',
      isModerated: false,
      created: new Date()
    })
    dbUser = await readminCollections.user.findOne({ _id: inserted.insertedId }) as User;
  }

  await readminCollections.user.updateOne({
    _id: dbUser._id,
  }, {
    $set: {
      thumbnail: user.picture,
      preferred_username: user.preferred_username,
      name: user.name,
      nickname: user.nickname,
      accessToken: encrypt(oauthInfo.access_token),
      refreshToken: encrypt(oauthInfo.refresh_token),
      accessTokenUpdatedAt: new Date(),
      lastLogin: new Date(),
    }
  })

  const realUser = await readminCollections.user.findOne({ robloxId: user.sub.toString() }) as User;
  if (realUser) {
    await updateStripeUser(realUser);
  }

  // Anchor the hub identity. The OAuth `sub` is the user's stable key in the
  // ReAdmin (OAuth) domain — the backbone that every game-scoped key links onto.
  // Capturing it at login means the link target exists before any /verify, and
  // keeps names fresh from a source that works even for scoped users.
  await ensureUserIdentity(user.sub.toString(), {
    username: user.preferred_username || user.name,
    displayName: user.name,
  }).catch((e) => {
    console.error('ensureUserIdentity failed at login', user.sub, e);
  });

  // Create JWT
  const token = sign(
    {
      secureToken,
      robloxId: dbUser.robloxId,
      name: dbUser.name,
      role: dbUser.role,
    },
    env.JSON_WEB_TOKEN_SECRET,
    { expiresIn: '7d' },
  );

  await readminCollections.user_auth_session.insertOne({
    _id: secureToken,
    robloxId: user.sub.toString(),
    created: new Date()
  })


  // Return new JWT
  return [token, realUser];
}

export async function createSessionFromDBUser(dbUser: User): Promise<[string, User]> {
  // Generate a secure token which is mathematically random to ensure the JWT can't be faked easily.
  const secureToken = await generateSecureString();

  // Create JWT
  const token = sign(
    {
      secureToken,
      robloxId: dbUser.robloxId,
      name: dbUser.name,
      role: dbUser.role,
    },
    env.JSON_WEB_TOKEN_SECRET,
    { expiresIn: '7d' },
  );

  await readminCollections.user_auth_session.insertOne({
    _id: secureToken,
    robloxId: dbUser.robloxId.toString(),
    created: new Date()
  })


  // Return new JWT
  return [token, dbUser];
}

export async function checkJWT(auth: string): Promise<JWTUser | null> {
  // `jsonwebtoken`'s verify(token, secret, callback) is callback-style and
  // returns void (not a promise), so `await`-ing it here does NOT wait for
  // the callback to run. The callback below was `async` and did real
  // database lookups inside it (session lookup, user lookup, Roblox API
  // calls) - those always take longer than the single tick `await verify()`
  // actually waits on, so this function was returning `user` (still `null`)
  // before the callback ever got a chance to set it. In practice that means
  // every auth check silently resolved to "not logged in" - but only after
  // however long those lookups took, which is why pages would render first
  // and then bounce back to /login a moment later.
  //
  // Fix: call verify() synchronously (it throws on an invalid/expired/
  // malformed token) and do the async work directly in this function, where
  // `await` actually works as intended.
  let verifiedUser: any;
  try {
    verifiedUser = verify(auth, env.JSON_WEB_TOKEN_SECRET);
  } catch {
    return null;
  }

  const session = await readminCollections.user_auth_session.findOne({ _id: verifiedUser.secureToken });
  if (!session) {
    return null;
  }

  const robloxId: string = verifiedUser.robloxId;

  if (verifiedUser.robloxId !== robloxId) {
    return null; // token mismatch, highly suspicous. probably should call FBI.
  }

  // Find the database user
  const dbUser = await readminCollections.user.findOne({
    robloxId: robloxId.toString(),
  });
  if (!dbUser) {
    return null;
  }

  if (dbUser.robloxId) {
    // getUserInfo/getUserThumbnail hit the live Roblox API and throw on any
    // hiccup (rate limit, timeout, transient network error). That used to be
    // unguarded, so a single flaky Roblox request would throw out of
    // checkJWT entirely -> createContext throws -> the request looks
    // unauthenticated even though the JWT/session were perfectly valid.
    // That's what caused the login loop: token saves fine, but the very
    // next request can fail this enrichment step and get treated as logged
    // out. Enrichment is optional, so degrade gracefully instead of failing
    // the whole auth check.
    try {
      const [info, thumbnail] = await Promise.all([
        getUserInfo(dbUser.robloxId),
        getUserThumbnail(dbUser.robloxId),
      ]);
      verifiedUser.roblox = info;
      verifiedUser.thumbnail = thumbnail;
    } catch (e) {
      console.error('Failed to enrich user with Roblox info during checkJWT', dbUser.robloxId, e);
    }
  }

  return { ...verifiedUser, dbUser };
}
