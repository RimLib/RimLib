import { open } from "node:fs/promises";

const readChunkBytes = 64 * 1024;

/** Read one regular UTF-8 file without ever allocating beyond the caller's explicit limit. */
export async function readBoundedUtf8File(
  path: string,
  maxBytes: number,
  description: string,
): Promise<string> {
  const file = await open(path, "r");
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) {
      throw new Error(`${description} is not a regular file.`);
    }
    if (metadata.size > maxBytes) {
      throw new Error(`${description} is too large (maximum ${maxBytes} bytes).`);
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const decode = (chunk?: Uint8Array, stream = false) => {
      try {
        return decoder.decode(chunk, { stream });
      } catch (error) {
        throw new Error(`${description} is not valid UTF-8.`, { cause: error });
      }
    };
    let text = "";
    let bytesRead = 0;
    // Read at most one byte beyond the limit so a file that grows after stat() is rejected
    // without allocating or parsing its unbounded contents.
    while (bytesRead <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(readChunkBytes, maxBytes + 1 - bytesRead));
      const result = await file.read(chunk, 0, chunk.length, null);
      if (result.bytesRead === 0) {
        return text + decode();
      }
      bytesRead += result.bytesRead;
      if (bytesRead > maxBytes) {
        throw new Error(`${description} is too large (maximum ${maxBytes} bytes).`);
      }
      text += decode(chunk.subarray(0, result.bytesRead), true);
    }
    throw new Error(`${description} is too large (maximum ${maxBytes} bytes).`);
  } finally {
    await file.close();
  }
}
