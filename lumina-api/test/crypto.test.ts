import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, issueToken, verifyToken } from "../src/crypto.js";

describe("crypto", () => {
  it("密钥加密往返一致，密文不含明文", () => {
    const secret = "sk-abc123XYZ_中文密钥-456";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("同一明文两次加密得到不同密文（随机 IV）", () => {
    expect(encryptSecret("same-key")).not.toBe(encryptSecret("same-key"));
  });

  it("密文被篡改时解密失败", () => {
    const enc = encryptSecret("secret");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1]! ^= 0xff;
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  it("token 签发与校验", () => {
    const t = issueToken(42);
    expect(verifyToken(t)).toBe(42);
  });

  it("伪造或损坏的 token 被拒绝", () => {
    const t = issueToken(42);
    const parts = t.split(".");
    expect(verifyToken(`${parts[0]}.${parts[1]}.AAAA`)).toBeNull();
    expect(verifyToken(`${parts[0]}.${parts[1]}`)).toBeNull();
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("1.deadbeef.deadbeef")).toBeNull();
  });
});
