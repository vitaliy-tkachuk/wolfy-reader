import { ZipError, ZipFormatError, ZipUnsupportedMethodError } from './errors.ts';

const STORED = 0;
const DEFLATED = 8;

export async function decompress(
  data: Uint8Array,
  method: number,
  name: string,
  expectedSize: number,
): Promise<Uint8Array> {
  if (method === STORED) return data.slice();
  if (method === DEFLATED) return inflateRaw(data, name, expectedSize);
  throw new ZipUnsupportedMethodError(`entry ${name} uses unsupported compression method ${method}`);
}

async function inflateRaw(data: Uint8Array, name: string, expectedSize: number): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      // slice() re-backs the view with a plain ArrayBuffer — a range reader may
      // hand back a SharedArrayBuffer-backed view, which BufferSource excludes.
      controller.enqueue(data.slice());
      controller.close();
    },
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = input.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // The central directory's size is the budget: stop the stream the moment
      // it overruns, so a lying header cannot make us buffer what it expands to.
      if (total > expectedSize) {
        await reader.cancel();
        throw new ZipFormatError(`entry ${name}: inflates past its declared ${expectedSize} bytes`);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof ZipError) throw cause;
    throw new ZipFormatError(`entry ${name}: corrupt deflate stream`, { cause });
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
