export class UploadBodyTooLargeError extends Error {}

/** Bound actual bytes before formData buffers them, including chunked requests. */
export async function limitedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("Invalid content length");
    if (length > maxBytes) throw new UploadBodyTooLargeError();
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    throw new TypeError("Expected multipart form data");
  }
  let bytes = 0;
  let oversized = false;
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        oversized = true;
        throw new UploadBodyTooLargeError();
      }
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(bounded, { headers: { "content-type": contentType } }).formData();
  } catch (error) {
    // Some multipart parsers wrap a stream error in a TypeError.
    if (oversized) throw new UploadBodyTooLargeError();
    throw error;
  }
}
