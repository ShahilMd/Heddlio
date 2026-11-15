/**
 * Opaque keyset cursors.
 *
 * A base64url JSON payload is not security: clients cannot forge a row, only
 * choose a starting point that is already in the same tenant-scoped query.
 * Keeping it opaque discourages clients from constructing cursors by hand and
 * leaves room to change the columns later without an API version bump.
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const encodeCursor = (
  payload: Record<string, string | number>,
): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

export const decodeCursor = (
  cursor: string | undefined,
): Record<string, unknown> | null => {
  if (!cursor) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return decoded && typeof decoded === "object"
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const readStringCursorField = (
  cursor: Record<string, unknown> | null,
  field: string,
): string | null => {
  const value = cursor?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const readNumberCursorField = (
  cursor: Record<string, unknown> | null,
  field: string,
): number | null => {
  const value = cursor?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
