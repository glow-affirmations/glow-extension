export function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteLength === 0) throw new Error("The cached audio file is empty.");
  return Uint8Array.from(bytes).buffer;
}
