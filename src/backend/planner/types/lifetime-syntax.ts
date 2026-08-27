import { rustLifetimeName } from "../../../target-model/lifetimes/index.js";
import type { RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import type { RustLifetime } from "../../target-ast/nodes.js";

export function rustLifetimeToAst(lifetime: RustLifetimeRef): RustLifetime {
  switch (lifetime.kind) {
    case "static":
      return { kind: "static" };
    case "placeholder":
    case "call-scoped-elision":
      return { kind: "placeholder" };
    case "parameter":
    case "bound":
      return { kind: "named", name: rustLifetimeName(lifetime) };
  }
}
