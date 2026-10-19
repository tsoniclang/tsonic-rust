import type { Node } from "@tsonic/tsts";

export interface RustNativeMemberVisibility {
  readonly public: "private" | "public";
  readonly internal: "private" | "crate";
}

export interface RustNativeMemberVisibilityRecords {
  readonly nativeMemberVisibility: { readonly get: (declaration: Node, publiclyReachable: boolean) => "private" | "crate" | "public" | undefined };
}
