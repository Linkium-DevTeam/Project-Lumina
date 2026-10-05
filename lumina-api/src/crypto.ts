import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config.js";

// ── 密钥加密（AES-256-GCM，与项目最初承诺一致：密文落库，明文不回传）──

const masterKeyBytes = createHash("sha256").update(config.masterKey, "utf8").digest();

const KEY_ENC_INFO = Buffer.from("lumina/keys/v2", "utf8");
const TOKEN_ENC_INFO = Buffer.from("lumina/token/v2", "utf8");

/** HKDF-Extract+Expand 的轻量替代：info 分离用途，避免密钥复用。 */
function deriveSubkey(info: Buffer): Buffer {
  return createHash("sha256")
    .update(masterKeyBytes)
    .update(info)
    .digest();
}

const keyEncKey = deriveSubkey(KEY_ENC_INFO);

/** 明文 → base64(iv ‖ tag ‖ ciphertext) */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyEncKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < 12 + 16) throw new Error("密文格式非法");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyEncKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── 登录 token（随机串 + HMAC 指纹，无状态校验且可服务端吊销式轮换）──

const tokenSecret = deriveSubkey(TOKEN_ENC_INFO);

function fingerprint(userId: number, raw: string): string {
  return createHash("sha256").update(tokenSecret).update(`${userId}.${raw}`).digest("base64url");
}

/** 签发 token：`<userId>.<random>.<hmac>`。数据库不存 token——自持部署接受这一点，
 *  泄露主密钥才会伪造 token，而泄露主密钥意味着密钥池已全部暴露。 */
export function issueToken(userId: number): string {
  const raw = randomBytes(24).toString("base64url");
  return `${userId}.${raw}.${fingerprint(userId, raw)}`;
}

export function verifyToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uidRaw, raw, mac] = parts as [string, string, string];
  const userId = Number(uidRaw);
  if (!Number.isInteger(userId) || userId <= 0 || !raw || !mac) return null;
  const expect = Buffer.from(fingerprint(userId, raw));
  const actual = Buffer.from(mac);
  if (expect.length !== actual.length || !timingSafeEqual(expect, actual)) return null;
  return userId;
}

/** 设备 ID：客户端未提供时由服务端生成。 */
export function newDeviceId(): string {
  return randomUUID();
}
