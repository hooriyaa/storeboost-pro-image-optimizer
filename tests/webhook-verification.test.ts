// modified-2026-09-16
import { describe, it, expect } from "vitest";
import crypto from "crypto";

/**
 * Shopify Webhook HMAC Verification helper for unit testing.
 * Shopify creates an HMAC-SHA256 hash using the raw request body and app secret,
 * then base64 encodes it and passes in X-Shopify-Hmac-SHA256.
 */
function generateShopifyHmac(rawBody: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
}

function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string,
  secret: string
): boolean {
  const generatedHash = generateShopifyHmac(rawBody, secret);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(generatedHash, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
  } catch {
    return false;
  }
}

describe("Shopify Webhook HMAC Verification", () => {
  const SECRET = "shpss_test_secret_key_123456789";
  const PAYLOAD = JSON.stringify({
    id: 123456789,
    domain: "test-shop.myshopify.com",
    topic: "app/uninstalled",
  });

  it("successfully verifies valid HMAC signature for raw payload", () => {
    const validHmac = generateShopifyHmac(PAYLOAD, SECRET);
    const isValid = verifyShopifyHmac(PAYLOAD, validHmac, SECRET);
    expect(isValid).toBe(true);
  });

  it("rejects invalid HMAC signature", () => {
    const invalidHmac = "invalid_fake_hmac_signature_base64==";
    const isValid = verifyShopifyHmac(PAYLOAD, invalidHmac, SECRET);
    expect(isValid).toBe(false);
  });

  it("rejects tampered request payload", () => {
    const validHmac = generateShopifyHmac(PAYLOAD, SECRET);
    const tamperedPayload = JSON.stringify({
      id: 123456789,
      domain: "attacker-shop.myshopify.com",
    });

    const isValid = verifyShopifyHmac(tamperedPayload, validHmac, SECRET);
    expect(isValid).toBe(false);
  });

  it("rejects when secret is mismatched", () => {
    const validHmac = generateShopifyHmac(PAYLOAD, SECRET);
    const wrongSecret = "wrong_secret_key_987654321";

    const isValid = verifyShopifyHmac(PAYLOAD, validHmac, wrongSecret);
    expect(isValid).toBe(false);
  });
});
