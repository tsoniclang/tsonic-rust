import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRustProviderPackage } from "./index.js";
import type { RustProviderModuleDefinition, RustProviderOperationRow, RustProviderPackageImplementation } from "./index.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType } from "../rust-target-types.js";

const targetPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const stringCarrier = rustStringTargetType();
const boolCarrier = rustSourcePrimitiveTargetType("bool");
const stringType = { kind: "string" } as const;

// Node is a provider package, not a compiler surface. Supported rows map to
// closed tsonic_rust_node APIs; every declared export without a row fails
// closed with a deterministic diagnostic. Fallible Node APIs (fs, crypto,
// process.cwd, ...) stay declared-but-unsupported until the shared error
// model lands.

function pathModule(): RustProviderModuleDefinition {
  const fn = (name: string, parameters: readonly { name: string; rest?: boolean }[], returns: { readonly kind: "string" } | { readonly kind: "boolean" } = stringType) => ({
    id: `node:path::${name}`,
    name,
    kind: "function" as const,
    signatures: [{
      id: `node:path::${name}(${parameters.map((parameter) => parameter.name).join(",")})`,
      name,
      parameters: parameters.map((parameter) => ({
        name: parameter.name,
        type: parameter.rest === true ? ({ kind: "array", elementType: stringType } as const) : stringType,
        ...(parameter.rest === true ? { rest: true } : {}),
      })),
      returnType: returns,
    }],
  });
  return {
    moduleSpecifier: "node:path",
    providerModuleId: "tsonic.rust.node.path",
    exports: [
      fn("join", [{ name: "paths", rest: true }]),
      fn("normalize", [{ name: "path" }]),
      fn("dirname", [{ name: "path" }]),
      fn("basename", [{ name: "path" }]),
      fn("extname", [{ name: "path" }]),
      fn("isAbsolute", [{ name: "path" }], { kind: "boolean" } as const),
      // Declared but unsupported until the error model lands (fallible).
      fn("resolve", [{ name: "paths", rest: true }]),
    ],
  };
}

function osModule(): RustProviderModuleDefinition {
  const fn = (name: string) => ({
    id: `node:os::${name}`,
    name,
    kind: "function" as const,
    signatures: [{ id: `node:os::${name}()`, name, parameters: [], returnType: stringType }],
  });
  return {
    moduleSpecifier: "node:os",
    providerModuleId: "tsonic.rust.node.os",
    exports: [fn("platform"), fn("arch"), fn("eol")],
  };
}

// Declared-only modules: the full surface stays visible and classified; every
// member selection diagnoses deterministically because no operation row
// exists.
function declaredOnlyModule(specifier: string, id: string, functionNames: readonly string[]): RustProviderModuleDefinition {
  return {
    moduleSpecifier: specifier,
    providerModuleId: id,
    exports: functionNames.map((name) => ({
      id: `${specifier}::${name}`,
      name,
      kind: "function" as const,
      signatures: [{
        id: `${specifier}::${name}(...)`,
        name,
        parameters: [{ name: "args", type: { kind: "array", elementType: { kind: "any" } as const } as const, rest: true }],
        returnType: { kind: "any" } as const,
      }],
    })),
  };
}

function pathRows(): readonly RustProviderOperationRow[] {
  const simple = (name: string, rustPath: string, resultCarrier = stringCarrier): RustProviderOperationRow => ({
    exportId: `node:path::${name}`,
    operationKind: "method",
    target: { form: "call", path: rustPath, argModes: ["ref"] },
    resultCarrier,
    parameterCarriers: [stringCarrier],
  });
  return [
    {
      exportId: "node:path::join",
      operationKind: "method",
      target: { form: "call-str-slice", path: "node_path::join" },
      resultCarrier: stringCarrier,
    },
    simple("normalize", "node_path::normalize"),
    simple("dirname", "node_path::dirname"),
    simple("extname", "node_path::extname"),
    simple("isAbsolute", "node_path::is_absolute", boolCarrier),
    {
      exportId: "node:path::basename",
      operationKind: "method",
      target: { form: "call", path: "node_path::basename", argModes: ["ref"], trailingArgs: ["None"] },
      resultCarrier: stringCarrier,
      parameterCarriers: [stringCarrier],
    },
  ];
}

function osRows(): readonly RustProviderOperationRow[] {
  return ["platform", "arch", "eol"].map((name): RustProviderOperationRow => ({
    exportId: `node:os::${name}`,
    operationKind: "method",
    target: {
      form: "call",
      path: `node_os::${name}`,
      // eol returns &'static str; the string carrier is owned.
      ...(name === "eol" ? { chain: ["to_string"] } : {}),
    },
    resultCarrier: stringCarrier,
  }));
}

export function createRustNodejsProviderPackage(): RustProviderPackageImplementation {
  return createRustProviderPackage({
    id: "nodejs",
    displayName: "Node.js provider package",
    version: "0.0.1",
    requiredSurfaces: ["js"],
    modules: [
      pathModule(),
      osModule(),
      declaredOnlyModule("node:fs", "tsonic.rust.node.fs", ["readFileSync", "writeFileSync", "existsSync", "readdirSync", "statSync"]),
      declaredOnlyModule("node:process", "tsonic.rust.node.process", ["cwd", "exit"]),
      declaredOnlyModule("node:url", "tsonic.rust.node.url", ["fileURLToPath", "pathToFileURL"]),
      declaredOnlyModule("node:buffer", "tsonic.rust.node.buffer", ["btoa", "atob"]),
      declaredOnlyModule("node:crypto", "tsonic.rust.node.crypto", ["randomUUID", "createHash"]),
      declaredOnlyModule("node:util", "tsonic.rust.node.util", ["format", "inspect"]),
    ],
    operations: [...pathRows(), ...osRows()],
    crates: [{
      crateName: "tsonic_rust_node",
      cargoPath: resolve(targetPackageRoot, "../rust-nodejs/crates/tsonic_rust_node"),
    }],
  });
}
