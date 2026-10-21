import { failTargetPlannerInvariant } from "@tsonic/target-api/artifacts";

export function failRustSyntaxInvariant(node: unknown, category: string): never {
  const kind = typeof node === "object" && node !== null && "kind" in node
    ? String((node as { readonly kind?: unknown }).kind) : "<missing-kind>";
  return failTargetPlannerInvariant("tsonic-rust", `Unsupported Rust ${category} syntax reached printer: ${kind}`);
}
