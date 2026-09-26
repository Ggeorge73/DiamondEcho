import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword,
  signOut, getMultiFactorResolver, multiFactor, TotpMultiFactorGenerator } from "firebase/auth";

// Only public Firebase configuration enters this bundle. Tokens stay in SDK memory.
export function createStaffAuth(config) {
  let auth, resolver, secret;
  async function ready() {
    if (!config?.enabled) throw new Error("Staff deployment is not configured.");
    if (!auth) {
      // No popup/redirect resolver or cross-origin auth iframe: email/password + TOTP only.
      auth = initializeAuth(initializeApp(config.firebase), { persistence: inMemoryPersistence });
    }
    return auth;
  }
  async function result(user) {
    if (!user.emailVerified) {
      await signOut(auth);
      throw new Error("Verify your approved staff email before signing in.");
    }
    if (!multiFactor(user).enrolledFactors.some(f => f.factorId === "totp")) {
      secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession());
      return { type: "enroll", secret: secret.secretKey };
    }
    return { type: "ready" };
  }
  return {
    async signIn(email, password) {
      await ready();
      try {
        return await result((await signInWithEmailAndPassword(auth, email, password)).user);
      } catch (error) {
        if (error.code !== "auth/multi-factor-auth-required") throw error;
        resolver = getMultiFactorResolver(auth, error);
        if (!resolver.hints.some(h => h.factorId === "totp")) throw new Error("A TOTP authenticator is required.");
        return { type: "mfa" };
      }
    },
    async completeMfa(code) {
      if (!resolver) throw new Error("Sign in again.");
      const hint = resolver.hints.find(h => h.factorId === "totp");
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
      const credential = await resolver.resolveSignIn(assertion);
      resolver = undefined;
      return result(credential.user);
    },
    async completeEnrollment(code) {
      if (!auth?.currentUser || !secret) throw new Error("Sign in again.");
      await multiFactor(auth.currentUser).enroll(
        TotpMultiFactorGenerator.assertionForEnrollment(secret, code), "DiamondEcho staff");
      // A fresh MFA sign-in must produce a second-factor token before the API can accept it.
      secret = undefined;
      await signOut(auth);
      return { type: "enrolled" };
    },
    async getToken() {
      if (!auth?.currentUser) throw new Error("Sign in again.");
      return auth.currentUser.getIdToken(true);
    },
    async signOut() {
      resolver = secret = undefined;
      if (auth) await signOut(auth);
    }
  };
}
