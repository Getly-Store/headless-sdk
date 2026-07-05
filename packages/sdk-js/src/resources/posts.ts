import type { Envelope, HttpClient } from '../http.js';
import type {
  MutationOptions,
  Page,
  Post,
  PostCreateInput,
  PostListParams,
  PostUpdateInput,
} from '../types.js';
import { paginate } from './paginate.js';

export class PostsResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/posts — your store's blog posts (cursor pagination). */
  async list(params: PostListParams = {}): Promise<Page<Post>> {
    const res = await this.http.request<Envelope<Page<Post>>>('GET', '/api/v1/posts', {
      query: { limit: params.limit, cursor: params.cursor, status: params.status },
    });
    return res.data;
  }

  iterate(params: Omit<PostListParams, 'cursor'> = {}): AsyncGenerator<Post> {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /** GET /api/v1/posts/{id} */
  async get(id: string): Promise<Post> {
    const res = await this.http.request<Envelope<Post>>(
      'GET',
      `/api/v1/posts/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /**
   * POST /api/v1/posts — markdown is the source of truth (contentMarkdown).
   * Daily cap: 5 posts/day per key (quota_exceeded).
   */
  async create(input: PostCreateInput, opts: MutationOptions = {}): Promise<Post> {
    const res = await this.http.request<Envelope<Post>>('POST', '/api/v1/posts', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /** PATCH /api/v1/posts/{id} */
  async update(id: string, input: PostUpdateInput): Promise<Post> {
    const res = await this.http.request<Envelope<Post>>(
      'PATCH',
      `/api/v1/posts/${encodeURIComponent(id)}`,
      { body: input },
    );
    return res.data;
  }

  /** DELETE /api/v1/posts/{id} */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const res = await this.http.request<Envelope<{ id: string; deleted: true }>>(
      'DELETE',
      `/api/v1/posts/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
