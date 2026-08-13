export async function checkJWT(auth: string): Promise<JWTUser | null> {
  // jsonwebtoken's callback-style verify() does NOT return a Promise, so the
  // old `await verify(...)` didn't actually wait for the async callback
  // (which does the DB session lookup) to finish before returning `user`.
  // That's why sessions weren't persisting. Using the synchronous form fixes it.
  let verifiedUser: any;
  try {
    verifiedUser = verify(auth, env.JSON_WEB_TOKEN_SECRET);
  } catch (err) {
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
    const [info, thumbnail] = await Promise.all([
      getUserInfo(dbUser.robloxId),
      getUserThumbnail(dbUser.robloxId),
    ]);
    verifiedUser.roblox = info;
    verifiedUser.thumbnail = thumbnail;
  }

  return { ...verifiedUser, dbUser };
}
