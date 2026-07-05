import { GetlyError } from '../error.js';
import { byteLength, toBodyInit, type Envelope, type HttpClient } from '../http.js';
import type { ImagePresign, ImagePresignInput, MutationOptions, UploadImageInput } from '../types.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — platform limit

export class UploadsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /api/v1/uploads/images/presign — presigned PUT for an image
   * (product images / post covers). image/* only, <= 10MB.
   */
  async presignImage(input: ImagePresignInput, opts: MutationOptions = {}): Promise<ImagePresign> {
    const res = await this.http.request<Envelope<ImagePresign>>(
      'POST',
      '/api/v1/uploads/images/presign',
      { body: input, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /**
   * One-call image upload: presign → PUT the bytes. Returns { publicUrl } to
   * reference in product images[] or a post's coverImageUrl.
   */
  async uploadImage(input: UploadImageInput): Promise<{ publicUrl: string }> {
    const size = byteLength(input.data);
    if (size <= 0) {
      throw new GetlyError('uploadImage: data is empty', { status: 0, code: 'validation_failed', param: 'data' });
    }
    if (size > MAX_IMAGE_BYTES) {
      throw new GetlyError(
        `uploadImage: image is ${size} bytes but the limit is 10MB. Compress or resize it first.`,
        { status: 0, code: 'validation_failed', param: 'data' },
      );
    }

    const presign = await this.presignImage({
      contentType: input.contentType,
      fileSize: size,
      fileName: input.fileName,
    });

    const putRes = await this.http.rawFetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': input.contentType, 'Content-Length': String(size) },
      body: toBodyInit(input.data),
    });
    if (!putRes.ok) {
      throw new GetlyError(
        `uploadImage: storage upload failed (HTTP ${putRes.status}). The presigned URL may have expired (1h) — retry uploadImage().`,
        { status: putRes.status, code: 'internal_error' },
      );
    }

    return { publicUrl: presign.publicUrl };
  }
}
