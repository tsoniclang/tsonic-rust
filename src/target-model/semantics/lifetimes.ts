import type { RustSemanticIdentity } from "./identity.js";

export type RustLifetimeRef =
  | { readonly kind: "static" }
  | {
      readonly kind: "parameter";
      readonly identity: RustSemanticIdentity;
      readonly displayName: string;
    }
  | {
      readonly kind: "bound";
      readonly binderId: string;
      readonly parameterId: string;
      readonly displayName: string;
    }
  | {
      readonly kind: "inferred-region";
      readonly regionId: string;
    };

export const rustStaticLifetime: RustLifetimeRef = Object.freeze({ kind: "static" });

export function rustLifetimeDisplayName(lifetime: RustLifetimeRef): string | undefined {
  switch (lifetime.kind) {
    case "static":
      return "static";
    case "parameter":
    case "bound":
      return lifetime.displayName;
    case "inferred-region":
      return undefined;
  }
}
