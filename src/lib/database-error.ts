/**
 * A returned PostgreSQL constraint/data/privilege error or an explicit PL/pgSQL
 * exception means that the statement failed. Network failures, gateway errors,
 * and SQLSTATEs such as statement_completion_unknown do not establish whether
 * the transaction committed. Treat those as uncertain before deleting data.
 */
export function isDefiniteDatabaseRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  return typeof code === 'string' && (code === 'P0001' || /^(22|23|42)[A-Z0-9]{3}$/.test(code));
}
