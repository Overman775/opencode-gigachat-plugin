import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILTIN_CA_BUNDLE } from "./certs.js";

describe("Built-in CA bundle", () => {
  it("contains a root and issuing CA with valid signatures", () => {
    const pemCerts = BUILTIN_CA_BUNDLE.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    expect(pemCerts).toHaveLength(2);
    const [root, issuing] = (pemCerts ?? []).map((pem) => new X509Certificate(pem));
    if (!root || !issuing) throw new Error("Missing built-in CA certificates");

    expect(root.ca).toBe(true);
    expect(issuing.ca).toBe(true);
    expect(root.verify(root.publicKey)).toBe(true);
    expect(issuing.checkIssued(root)).toBe(true);
    expect(issuing.verify(root.publicKey)).toBe(true);
  });
});
