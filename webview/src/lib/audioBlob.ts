const CUSTOM_AUDIO_MIME_TYPE = "audio/mpeg" as const;

export function customAudioBlob(bytes: ArrayBuffer, mimeType: string): Blob {
  if (bytes.byteLength === 0) throw new Error("The cached audio file is empty.");
  if (mimeType !== CUSTOM_AUDIO_MIME_TYPE) {
    throw new Error("The cached audio file has an unsupported format.");
  }
  return new Blob([bytes], { type: CUSTOM_AUDIO_MIME_TYPE });
}
