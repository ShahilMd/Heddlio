/**
 * Nest's pg driver surfaces Postgres error codes as plain properties. Narrowing
 * them here keeps every service from re-implementing the same `as` cast.
 */
interface PgErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
}

const asPgError = (error: unknown): PgErrorLike | null =>
  error && typeof error === "object" ? (error as PgErrorLike) : null;

export const isPgUniqueViolation = (
  error: unknown,
  constraint?: string,
): boolean => {
  const pgError = asPgError(error);
  return (
    pgError?.code === "23505" &&
    (constraint === undefined || pgError.constraint === constraint)
  );
};

export const isPgForeignKeyViolation = (error: unknown): boolean =>
  asPgError(error)?.code === "23503";

export const isPgCheckViolation = (error: unknown): boolean =>
  asPgError(error)?.code === "23514";
