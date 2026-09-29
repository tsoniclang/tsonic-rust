export function printRustClosureParams(
  params: readonly { readonly name: string; readonly mutable?: boolean; readonly byRefCopy?: boolean }[],
): string {
  return params
    .map((param) => param.byRefCopy === true
      ? param.mutable === true ? `&(mut ${param.name})` : `&${param.name}`
      : `${param.mutable === true ? "mut " : ""}${param.name}`)
    .join(", ");
}
