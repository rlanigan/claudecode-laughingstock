// Error taxonomy (HANDOFF.md §20). Services throw DomainError; http.ts maps it to a response.

export const ERROR_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  TAG_INVALID: 422,
  TAG_LIMIT: 422,
  CONFLICT: 409,
  NAME_TAKEN: 409,
  ALREADY_ON_BOARD: 409,
  ALREADY_IN_BIT: 409,
  ALREADY_PROMOTED: 409,
  CARD_KILLED: 409,
  CARD_NOT_KILLED: 409,
  CARD_IN_HISTORY: 409,
  CARD_IN_BIT: 409,
  BIT_IN_HISTORY: 409,
  BIT_IN_SETS: 409,
  REVISION_FROZEN: 409,
  REVISION_NOT_VARIANT: 409,
  REVISION_NOT_ANCHOR: 400,
  BASE_NOT_ANCHOR: 422,
  BIT_ALREADY_IN_BASE: 422,
  BIT_REQUIRED: 422,
  WORKING_COPY_CHANGED: 409,
  WORKING_EMPTY: 422,
  BIT_NOT_IN_REVISION: 422,
  ANGLE_LIMIT: 409,
  ROOT_UNDELETABLE: 422,
  NOT_A_POINT_ANSWER: 422,
  ORDER_MISMATCH: 422,
  SPLIT_INVALID: 422,
  CLUSTER_EMPTY: 422,
  ARCHIVE_FIRST: 409,
  LIMIT_REACHED: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  AI_DISABLED: 409,
  AI_DISABLED_BY_SERVER: 409,
  INVALID_CURSOR: 422,
  UPLOAD_MISSING: 409,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: keyof typeof ERROR_STATUS | string, message: string, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
    this.details = details;
  }
}

export const notFound = (what = "That") => new DomainError("NOT_FOUND", `${what} doesn't exist or was deleted.`);
export const conflict = (message: string, details?: unknown) => new DomainError("CONFLICT", message, details);
export const limitReached = (n: number, things: string) =>
  new DomainError("LIMIT_REACHED", `You've hit the limit of ${n} ${things}.`);
