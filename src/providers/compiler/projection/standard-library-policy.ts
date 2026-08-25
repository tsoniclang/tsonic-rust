import type { RustProviderTypeSemanticRole } from "../../packages/model.js";

type RustCallableTraitRole = Extract<
  RustProviderTypeSemanticRole,
  { readonly kind: "callable-trait" }
>;

const standardTypeSemanticRoles = new Map<string, readonly RustProviderTypeSemanticRole[]>([
  [
    key(Object.freeze(["core", "pin", "Pin"])),
    Object.freeze([
      Object.freeze({ kind: "pin-wrapper" as const, pointerArgumentIndex: 0 }),
    ]),
  ],
  ...([
    ["Fn", "fn"],
    ["FnMut", "fn-mut"],
    ["FnOnce", "fn-once"],
  ] as const).map(([name, callTrait]) => [
    key(Object.freeze(["core", "ops", "function", name])),
    Object.freeze([
      Object.freeze({
        kind: "callable-trait" as const,
        callTrait,
        parameterTupleSourceName: "Args",
        resultSourceName: "Output",
      }),
    ]),
  ] as const),
]);

export function standardRustTypeSemanticRoles(
  canonicalPath: readonly string[],
): readonly RustProviderTypeSemanticRole[] {
  return standardTypeSemanticRoles.get(key(canonicalPath)) ?? Object.freeze([]);
}

export function standardRustCallableTraitRole(
  canonicalPath: readonly string[],
): RustCallableTraitRole | undefined {
  return standardRustTypeSemanticRoles(canonicalPath).find(
    (role): role is RustCallableTraitRole => role.kind === "callable-trait",
  );
}

function key(path: readonly string[]): string {
  return path.join("\0");
}
