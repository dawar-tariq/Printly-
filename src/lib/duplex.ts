/** A file and each of its copies start on a fresh sheet. */
export function duplexSheetsPerCopy(pages: number): number {
  return Math.ceil(pages / 2);
}

export function duplexSheets(pages: number, copies: number): number {
  return duplexSheetsPerCopy(pages) * copies;
}
