const PBKDF2_ITERATIONS = 120_000;

export interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export async function createPasswordRecord(password: string): Promise<PasswordRecord> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashBytes = await deriveHash(password, saltBytes, PBKDF2_ITERATIONS);
  return {
    salt: bytesToBase64(saltBytes),
    hash: bytesToBase64(hashBytes),
    iterations: PBKDF2_ITERATIONS,
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const salt = base64ToBytes(record.salt);
  const hash = await deriveHash(password, salt, record.iterations);
  return bytesToBase64(hash) === record.hash;
}

async function deriveHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let str = "";
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str);
}

function base64ToBytes(base64: string): Uint8Array {
  const str = atob(base64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}
