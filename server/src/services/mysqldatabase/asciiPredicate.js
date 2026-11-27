// A term containing non-ASCII characters cannot match an ASCII column. Keep other OR members and their parameters intact.
export function asciiPredicate(sql, ...params) {
  return params.every(value => !/\P{ASCII}/u.test(value))
    ? { sql, params }
    : { sql: "FALSE", params: [] };
}
