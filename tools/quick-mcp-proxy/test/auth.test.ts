/**
 * Inbound auth tests. Uses a locally generated key pair + in-memory JWKS, so no
 * IdP or network is needed. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";
import { createAuthorizer, isLoopbackHost, type InboundAuthConfig, type OAuthConfig } from "../src/auth.ts";

const ISSUER = "https://issuer.example.com/pool-test";
const CLIENT_ID = "quick-client-test";
const SCOPE = "groundwork-coa/query";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
const jwks = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair("RS256");

const oauth: OAuthConfig = {
  issuer: ISSUER,
  jwksUrl: `${ISSUER}/.well-known/jwks.json`,
  audiences: [],
  clientIds: [CLIENT_ID],
  requiredScope: SCOPE,
};

async function sign(claims: JWTPayload, opts: { key?: CryptoKey; iss?: string; exp?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

const good = { token_use: "access", client_id: CLIENT_ID, scope: SCOPE };

test("fail closed: nothing configured rejects everything", async () => {
  const auth = createAuthorizer({ localTokens: [] }, { loopback: true });
  assert.equal(await auth(undefined), false);
  assert.equal(await auth("Bearer anything"), false);
});

test("local token: accepted on loopback, constant-time match, exact value only", async () => {
  const cfg: InboundAuthConfig = { localTokens: ["s3cret-local"] };
  const auth = createAuthorizer(cfg, { loopback: true });
  assert.equal(await auth("Bearer s3cret-local"), true);
  assert.equal(await auth("bearer s3cret-local"), true);
  assert.equal(await auth("Bearer s3cret-loca"), false);
  assert.equal(await auth("Bearer s3cret-local-x"), false);
  assert.equal(await auth("s3cret-local"), false);
  assert.equal(await auth(undefined), false);
});

test("local token: ignored on a non-loopback bind", async () => {
  const auth = createAuthorizer({ localTokens: ["s3cret-local"] }, { loopback: false });
  assert.equal(await auth("Bearer s3cret-local"), false);
});

test("oauth: valid client_credentials access token is accepted", async () => {
  const auth = createAuthorizer({ oauth, localTokens: [] }, { loopback: false, jwks });
  assert.equal(await auth(`Bearer ${await sign(good)}`), true);
});

test("oauth: rejects wrong signer, issuer, client, scope, token_use, expiry", async () => {
  const auth = createAuthorizer({ oauth, localTokens: [] }, { loopback: false, jwks });
  const cases: Array<[string, Promise<string>]> = [
    ["wrong key", sign(good, { key: other.privateKey })],
    ["wrong issuer", sign(good, { iss: "https://evil.example.com" })],
    ["wrong client", sign({ ...good, client_id: "someone-else" })],
    ["missing scope", sign({ ...good, scope: "other/scope" })],
    ["id token", sign({ ...good, token_use: "id" })],
    ["expired", sign(good, { exp: "-1m" })],
  ];
  for (const [name, tok] of cases) {
    assert.equal(await auth(`Bearer ${await tok}`), false, name);
  }
  assert.equal(await auth("Bearer not.a.jwt"), false, "garbage");
});

test("oauth: audience allowlist (IdPs that set aud)", async () => {
  const audCfg: OAuthConfig = { ...oauth, audiences: ["api://groundwork-coa"], clientIds: [], requiredScope: undefined };
  const auth = createAuthorizer({ oauth: audCfg, localTokens: [] }, { loopback: false, jwks });
  assert.equal(await auth(`Bearer ${await sign({ aud: "api://groundwork-coa" })}`), true);
  assert.equal(await auth(`Bearer ${await sign({ aud: "api://other" })}`), false);
});

test("isLoopbackHost", () => {
  for (const h of ["127.0.0.1", "127.0.0.2", "::1", "localhost"]) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ["0.0.0.0", "::", "10.0.0.5", "example.com"]) assert.equal(isLoopbackHost(h), false, h);
});
