export class BizError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new BizError("UNAUTHORIZED", "请先登录", 401),
  forbidden: (msg = "没有权限") => new BizError("FORBIDDEN", msg, 403),
  notFound: (msg = "资源不存在") => new BizError("NOT_FOUND", msg, 404),
  conflict: (msg: string) => new BizError("CONFLICT", msg, 409),
  badRequest: (msg: string) => new BizError("BAD_REQUEST", msg, 400),
  rateLimited: (msg = "太快了，先深呼吸，稍后再试") =>
    new BizError("RATE_LIMITED", msg, 429),
  providerUnavailable: (msg = "当前没有可用的 AI 提供商，稍后再试或添加自有 Key") =>
    new BizError("PROVIDER_UNAVAILABLE", msg, 503),
  upstream: (msg: string) => new BizError("UPSTREAM_ERROR", msg, 502),
};
