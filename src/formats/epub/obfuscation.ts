import { attribute, descendantsNamed, parseXml } from '../xml.ts';
import { resolveHref } from './href.ts';

/** EPUB 3.3 §4.4 — the one obfuscation the decoder can undo. */
const IDPF_ALGORITHM = 'http://www.idpf.org/2008/embedding';
const OBFUSCATED_PREFIX_LENGTH = 1040;

export interface Encryption {
  /** Zip entry names obfuscated with the IDPF algorithm; served de-obfuscated. */
  readonly obfuscated: ReadonlySet<string>;
  /** Zip entry names under any other EncryptionMethod; refused on load(). */
  readonly encrypted: ReadonlySet<string>;
}

/**
 * Reads META-INF/encryption.xml. Each EncryptedData names an algorithm and a
 * CipherReference URI relative to the container root; the URI goes through the
 * same href normalization as manifest hrefs so both sides key the same entry name.
 */
export function parseEncryption(xml: string): Encryption {
  const root = parseXml(xml);
  const obfuscated = new Set<string>();
  const encrypted = new Set<string>();
  for (const data of descendantsNamed(root, 'EncryptedData')) {
    const uri = descendantsNamed(data, 'CipherReference')
      .map((reference) => attribute(reference, 'URI'))
      .find((value) => value !== undefined && value !== '');
    const path = uri === undefined ? undefined : resolveHref('', uri)?.path;
    if (path === undefined) continue;
    const method = descendantsNamed(data, 'EncryptionMethod')[0];
    const algorithm = method === undefined ? undefined : attribute(method, 'Algorithm')?.trim();
    (algorithm === IDPF_ALGORITHM ? obfuscated : encrypted).add(path);
  }
  return { obfuscated, encrypted };
}

/**
 * The obfuscation key: SHA-1 of the package's unique identifier with U+0020,
 * U+0009, U+000D and U+000A removed (§4.4.3). SHA-1 is what the spec mandates
 * for key derivation — it is not a security choice and must not be upgraded.
 */
export async function obfuscationKey(identifier: string): Promise<Uint8Array> {
  const stripped = identifier.replace(/[ \t\r\n]/g, '');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(stripped));
  return new Uint8Array(digest);
}

/** XORs the first 1040 bytes with the key cycled; the rest is copied verbatim. */
export function deobfuscate(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  const end = Math.min(OBFUSCATED_PREFIX_LENGTH, out.length);
  for (let i = 0; i < end; i += 1) {
    out[i] = (out[i] as number) ^ (key[i % key.length] as number);
  }
  return out;
}
