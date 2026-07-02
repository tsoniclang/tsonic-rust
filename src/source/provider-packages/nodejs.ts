import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRustProviderPackage } from "./index.js";
import type { RustProviderModuleDefinition, RustProviderOperationRow, RustProviderPackageImplementation } from "./index.js";
import { rustSourcePrimitiveTargetType, rustStringTargetType, rustVecTargetType } from "../rust-target-types.js";
import type { TargetTypeRef } from "@tsonic/tsts";

const targetPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const stringCarrier = rustStringTargetType();
const boolCarrier = rustSourcePrimitiveTargetType("bool");
const int32Carrier = rustSourcePrimitiveTargetType("int32");
const float64Carrier = rustSourcePrimitiveTargetType("float64");
const stringVecCarrier = rustVecTargetType(stringCarrier);
const statsCarrier: TargetTypeRef = { kind: "target-named", id: "rust.node.Stats" };
const bufferCarrier: TargetTypeRef = { kind: "target-named", id: "rust.node.Buffer" };
const urlCarrier: TargetTypeRef = { kind: "target-named", id: "rust.node.Url" };
const searchParamsCarrier: TargetTypeRef = { kind: "target-named", id: "rust.node.UrlSearchParams" };
const hashCarrier: TargetTypeRef = { kind: "target-named", id: "rust.node.Hash" };

const stringType = { kind: "string" } as const;
const numberType = { kind: "number" } as const;
const booleanType = { kind: "boolean" } as const;
const voidType = { kind: "void" } as const;
const stringArrayType = { kind: "array", elementType: stringType } as const;

type ProviderTypeExpr =
  | typeof stringType
  | typeof numberType
  | typeof booleanType
  | typeof voidType
  | typeof stringArrayType
  | { readonly kind: "provider-ref"; readonly moduleSpecifier: string; readonly exportName: string }
  | { readonly kind: "array"; readonly elementType: ProviderTypeExpr }
  | { readonly kind: "any" };

// Node is a provider package, not a compiler surface. Supported rows map to
// closed tsonic_rust_node APIs with exact declaration identities; every
// declared export without a row fails closed with a deterministic
// diagnostic that names the selected identity. Unsupported rows each state
// the concrete contract they require.

function providerRef(moduleSpecifier: string, exportName: string): ProviderTypeExpr {
  return { kind: "provider-ref", moduleSpecifier, exportName };
}

function fnExport(moduleSpecifier: string, name: string, parameters: readonly { name: string; type: ProviderTypeExpr; rest?: boolean }[], returnType: ProviderTypeExpr) {
  return {
    id: `${moduleSpecifier}::${name}`,
    name,
    kind: "function" as const,
    signatures: [{
      id: `${moduleSpecifier}::${name}(${parameters.map((parameter) => parameter.name).join(",")})`,
      name,
      parameters: parameters.map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
        ...(parameter.rest === true ? { rest: true } : {}),
      })),
      returnType,
    }],
  };
}

function methodMember(classId: string, name: string, parameters: readonly { name: string; type: ProviderTypeExpr }[], returnType: ProviderTypeExpr, options?: { readonly static?: boolean }) {
  return {
    id: `${classId}.${name}`,
    name,
    kind: "method" as const,
    ...(options?.static === true ? { static: true } : {}),
    signatures: [{
      id: `${classId}.${name}(${parameters.map((parameter) => parameter.name).join(",")})`,
      parameters: parameters.map((parameter) => ({ name: parameter.name, type: parameter.type })),
      returnType,
    }],
  };
}

function propertyMember(classId: string, name: string, type: ProviderTypeExpr) {
  return {
    id: `${classId}.${name}`,
    name,
    kind: "property" as const,
    readonly: true,
    type,
  };
}

function constructorMember(classId: string, parameters: readonly { name: string; type: ProviderTypeExpr }[]) {
  return {
    id: `${classId}.constructor`,
    name: "constructor",
    kind: "constructor" as const,
    signatures: [{
      id: `${classId}.constructor(${parameters.map((parameter) => parameter.name).join(",")})`,
      parameters: parameters.map((parameter) => ({ name: parameter.name, type: parameter.type })),
      returnType: voidType,
    }],
  };
}

// Declared exports without rows: selecting them diagnoses deterministically.
// Each carries documentation naming the contract it requires.
function unsupportedFn(moduleSpecifier: string, name: string, requires: string) {
  return {
    id: `${moduleSpecifier}::${name}`,
    name,
    kind: "function" as const,
    documentation: `Unsupported: requires ${requires}.`,
    signatures: [{
      id: `${moduleSpecifier}::${name}(...)`,
      name,
      parameters: [{ name: "args", type: { kind: "array", elementType: { kind: "any" } as const } as const, rest: true }],
      returnType: { kind: "any" } as const,
    }],
  };
}

// --- node:path ---------------------------------------------------------------

function pathModule(): RustProviderModuleDefinition {
  const m = "node:path";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.path",
    exports: [
      fnExport(m, "join", [{ name: "paths", type: stringArrayType, rest: true }], stringType),
      fnExport(m, "resolve", [{ name: "paths", type: stringArrayType, rest: true }], stringType),
      fnExport(m, "normalize", [{ name: "path", type: stringType }], stringType),
      fnExport(m, "dirname", [{ name: "path", type: stringType }], stringType),
      fnExport(m, "basename", [{ name: "path", type: stringType }], stringType),
      fnExport(m, "extname", [{ name: "path", type: stringType }], stringType),
      fnExport(m, "isAbsolute", [{ name: "path", type: stringType }], booleanType),
    ],
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
    { exportId: "node:path::join", operationKind: "method", target: { form: "call-str-slice", path: "node_path::join" }, resultCarrier: stringCarrier },
    { exportId: "node:path::resolve", operationKind: "method", target: { form: "call-str-slice", path: "node_path::resolve" }, resultCarrier: stringCarrier, isFallible: true },
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

// --- node:os -----------------------------------------------------------------

function osModule(): RustProviderModuleDefinition {
  const m = "node:os";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.os",
    exports: [
      fnExport(m, "platform", [], stringType),
      fnExport(m, "arch", [], stringType),
      fnExport(m, "eol", [], stringType),
      fnExport(m, "hostname", [], stringType),
      fnExport(m, "tmpdir", [], stringType),
      // Contract: empty string when the home directory is unknown.
      fnExport(m, "homedir", [], stringType),
    ],
  };
}

function osRows(): readonly RustProviderOperationRow[] {
  const call = (name: string, path: string, extra?: Partial<RustProviderOperationRow>): RustProviderOperationRow => ({
    exportId: `node:os::${name}`,
    operationKind: "method",
    target: { form: "call", path },
    resultCarrier: stringCarrier,
    ...extra,
  });
  return [
    call("platform", "node_os::platform"),
    call("arch", "node_os::arch"),
    { exportId: "node:os::eol", operationKind: "method", target: { form: "call", path: "node_os::eol", chain: ["to_string"] }, resultCarrier: stringCarrier },
    call("hostname", "node_os::hostname"),
    call("tmpdir", "node_os::tmpdir", { isFallible: true }),
    { exportId: "node:os::homedir", operationKind: "method", target: { form: "call", path: "node_os::homedir", chain: ["unwrap_or_default"] }, resultCarrier: stringCarrier },
  ];
}

// --- node:fs -----------------------------------------------------------------

function fsModule(): RustProviderModuleDefinition {
  const m = "node:fs";
  const statsId = "node:fs::Stats";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.fs",
    exports: [
      fnExport(m, "existsSync", [{ name: "path", type: stringType }], booleanType),
      fnExport(m, "readFileSync", [{ name: "path", type: stringType }, { name: "encoding", type: stringType }], stringType),
      fnExport(m, "writeFileSync", [{ name: "path", type: stringType }, { name: "data", type: stringType }, { name: "encoding", type: stringType }], voidType),
      fnExport(m, "readdirSync", [{ name: "path", type: stringType }], stringArrayType),
      fnExport(m, "statSync", [{ name: "path", type: stringType }], providerRef(m, "Stats")),
      // Contract: recursive.
      fnExport(m, "mkdirSync", [{ name: "path", type: stringType }], voidType),
      // Contract: recursive and force.
      fnExport(m, "rmSync", [{ name: "path", type: stringType }], voidType),
      fnExport(m, "unlinkSync", [{ name: "path", type: stringType }], voidType),
      fnExport(m, "copyFileSync", [{ name: "from", type: stringType }, { name: "to", type: stringType }], voidType),
      fnExport(m, "renameSync", [{ name: "from", type: stringType }, { name: "to", type: stringType }], voidType),
      fnExport(m, "realpathSync", [{ name: "path", type: stringType }], stringType),
      {
        id: statsId,
        name: "Stats",
        kind: "class" as const,
        members: [
          methodMember(statsId, "isFile", [], booleanType),
          methodMember(statsId, "isDirectory", [], booleanType),
          propertyMember(statsId, "size", numberType),
        ],
      },
      unsupportedFn(m, "watch", "a filesystem event subscription contract"),
      unsupportedFn(m, "createReadStream", "a stream carrier contract"),
      unsupportedFn(m, "createWriteStream", "a stream carrier contract"),
    ],
  };
}

function fsRows(): readonly RustProviderOperationRow[] {
  const statsId = "node:fs::Stats";
  const fallible = (name: string, path: string, resultCarrier: TargetTypeRef, parameterCarriers: readonly TargetTypeRef[], trailingArgs?: readonly string[]): RustProviderOperationRow => ({
    exportId: `node:fs::${name}`,
    operationKind: "method",
    target: { form: "call", path, argModes: parameterCarriers.map(() => "ref"), ...(trailingArgs === undefined ? {} : { trailingArgs }) },
    resultCarrier,
    parameterCarriers,
    isFallible: true,
  });
  return [
    { exportId: "node:fs::existsSync", operationKind: "method", target: { form: "call", path: "node_fs::exists_sync", argModes: ["ref"] }, resultCarrier: boolCarrier, parameterCarriers: [stringCarrier] },
    fallible("readFileSync", "node_fs::read_file_sync_string", stringCarrier, [stringCarrier, stringCarrier]),
    fallible("writeFileSync", "node_fs::write_file_sync_string", { kind: "tuple", elements: [] }, [stringCarrier, stringCarrier, stringCarrier]),
    fallible("readdirSync", "node_fs::readdir_sync", stringVecCarrier, [stringCarrier]),
    fallible("statSync", "node_fs::stat_sync", statsCarrier, [stringCarrier]),
    fallible("mkdirSync", "node_fs::mkdir_sync", { kind: "tuple", elements: [] }, [stringCarrier], ["true"]),
    fallible("rmSync", "node_fs::rm_sync", { kind: "tuple", elements: [] }, [stringCarrier], ["true", "true"]),
    fallible("unlinkSync", "node_fs::unlink_sync", { kind: "tuple", elements: [] }, [stringCarrier]),
    fallible("copyFileSync", "node_fs::copy_file_sync", { kind: "tuple", elements: [] }, [stringCarrier, stringCarrier]),
    fallible("renameSync", "node_fs::rename_sync", { kind: "tuple", elements: [] }, [stringCarrier, stringCarrier]),
    fallible("realpathSync", "node_fs::realpath_sync", stringCarrier, [stringCarrier]),
    { exportId: statsId, memberId: `${statsId}.isFile`, operationKind: "method", target: { form: "receiver-method", name: "is_file" }, resultCarrier: boolCarrier },
    { exportId: statsId, memberId: `${statsId}.isDirectory`, operationKind: "method", target: { form: "receiver-method", name: "is_directory" }, resultCarrier: boolCarrier },
    { exportId: statsId, memberId: `${statsId}.size`, operationKind: "property", target: { form: "field", name: "size" }, resultCarrier: float64Carrier, castResult: "f64" },
  ];
}

// --- node:fs/promises --------------------------------------------------------

function fsPromisesModule(): RustProviderModuleDefinition {
  const m = "node:fs/promises";
  const statsId = "node:fs/promises::Stats";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.fs-promises",
    exports: [
      {
        id: statsId,
        name: "Stats",
        kind: "class" as const,
        members: [
          methodMember(statsId, "isFile", [], booleanType),
          methodMember(statsId, "isDirectory", [], booleanType),
          propertyMember(statsId, "size", numberType),
        ],
      },
      fnExport(m, "readFile", [{ name: "path", type: stringType }, { name: "encoding", type: stringType }], stringType),
      fnExport(m, "writeFile", [{ name: "path", type: stringType }, { name: "data", type: stringType }, { name: "encoding", type: stringType }], voidType),
      fnExport(m, "readdir", [{ name: "path", type: stringType }], stringArrayType),
      fnExport(m, "stat", [{ name: "path", type: stringType }], providerRef(m, "Stats")),
      // Contract: recursive.
      fnExport(m, "mkdir", [{ name: "path", type: stringType }], voidType),
      // Contract: recursive and force.
      fnExport(m, "rm", [{ name: "path", type: stringType }], voidType),
      fnExport(m, "unlink", [{ name: "path", type: stringType }], voidType),
      fnExport(m, "copyFile", [{ name: "from", type: stringType }, { name: "to", type: stringType }], voidType),
      fnExport(m, "rename", [{ name: "from", type: stringType }, { name: "to", type: stringType }], voidType),
    ],
  };
}

function fsPromisesRows(): readonly RustProviderOperationRow[] {
  const row = (name: string, path: string, resultCarrier: TargetTypeRef, parameterCount: number, trailingArgs?: readonly string[]): RustProviderOperationRow => ({
    exportId: `node:fs/promises::${name}`,
    operationKind: "method",
    target: {
      form: "call",
      path,
      argModes: Array.from({ length: parameterCount }, () => "ref" as const),
      ...(trailingArgs === undefined ? {} : { trailingArgs }),
    },
    resultCarrier,
    parameterCarriers: Array.from({ length: parameterCount }, () => stringCarrier),
    isFallible: true,
    isAsync: true,
  });
  const unit: TargetTypeRef = { kind: "tuple", elements: [] };
  const statsId = "node:fs/promises::Stats";
  return [
    { exportId: statsId, memberId: `${statsId}.isFile`, operationKind: "method", target: { form: "receiver-method", name: "is_file" }, resultCarrier: boolCarrier },
    { exportId: statsId, memberId: `${statsId}.isDirectory`, operationKind: "method", target: { form: "receiver-method", name: "is_directory" }, resultCarrier: boolCarrier },
    { exportId: statsId, memberId: `${statsId}.size`, operationKind: "property", target: { form: "field", name: "size" }, resultCarrier: float64Carrier, castResult: "f64" },
    row("readFile", "node_fs_promises::read_file_string_async", stringCarrier, 2),
    row("writeFile", "node_fs_promises::write_file_string_async", unit, 3),
    row("readdir", "node_fs_promises::readdir_async", stringVecCarrier, 1),
    row("stat", "node_fs_promises::stat_async", statsCarrier, 1),
    row("mkdir", "node_fs_promises::mkdir_async", unit, 1, ["true"]),
    row("rm", "node_fs_promises::rm_async", unit, 1, ["true", "true"]),
    row("unlink", "node_fs_promises::unlink_async", unit, 1),
    row("copyFile", "node_fs_promises::copy_file_async", unit, 2),
    row("rename", "node_fs_promises::rename_async", unit, 2),
  ];
}

// --- node:process ------------------------------------------------------------

function processModule(): RustProviderModuleDefinition {
  const m = "node:process";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.process",
    exports: [
      fnExport(m, "cwd", [], stringType),
      fnExport(m, "platform", [], stringType),
      fnExport(m, "arch", [], stringType),
      // Contract: empty string when the variable is unset.
      fnExport(m, "envGet", [{ name: "name", type: stringType }], stringType),
      fnExport(m, "envSet", [{ name: "name", type: stringType }, { name: "value", type: stringType }], voidType),
      fnExport(m, "envDelete", [{ name: "name", type: stringType }], voidType),
      fnExport(m, "argv", [], stringArrayType),
      fnExport(m, "execPath", [], stringType),
      fnExport(m, "pid", [], numberType),
      fnExport(m, "ppid", [], numberType),
      // Contract: zero when no exit code has been set.
      fnExport(m, "exitCode", [], numberType),
      fnExport(m, "setExitCode", [{ name: "code", type: numberType }], voidType),
      unsupportedFn(m, "exit", "a process-termination policy contract"),
    ],
  };
}

function processRows(): readonly RustProviderOperationRow[] {
  const m = "node:process";
  return [
    { exportId: `${m}::cwd`, operationKind: "method", target: { form: "call", path: "node_process::cwd" }, resultCarrier: stringCarrier, isFallible: true },
    { exportId: `${m}::platform`, operationKind: "method", target: { form: "call", path: "node_process::platform" }, resultCarrier: stringCarrier },
    { exportId: `${m}::arch`, operationKind: "method", target: { form: "call", path: "node_process::arch" }, resultCarrier: stringCarrier },
    { exportId: `${m}::envGet`, operationKind: "method", target: { form: "call", path: "node_process::env_get", argModes: ["ref"], chain: ["unwrap_or_default"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier] },
    { exportId: `${m}::envSet`, operationKind: "method", target: { form: "call", path: "node_process::env_set", argModes: ["ref", "ref"] }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [stringCarrier, stringCarrier] },
    { exportId: `${m}::envDelete`, operationKind: "method", target: { form: "call", path: "node_process::env_delete", argModes: ["ref"] }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [stringCarrier] },
    { exportId: `${m}::argv`, operationKind: "method", target: { form: "call", path: "node_process::argv" }, resultCarrier: stringVecCarrier },
    { exportId: `${m}::execPath`, operationKind: "method", target: { form: "call", path: "node_process::exec_path" }, resultCarrier: stringCarrier, isFallible: true },
    { exportId: `${m}::pid`, operationKind: "method", target: { form: "call", path: "node_process::pid" }, resultCarrier: int32Carrier, castResult: "i32" },
    { exportId: `${m}::ppid`, operationKind: "method", target: { form: "call", path: "node_process::ppid" }, resultCarrier: int32Carrier, castResult: "i32" },
    { exportId: `${m}::exitCode`, operationKind: "method", target: { form: "call", path: "node_process::exit_code", chain: ["unwrap_or_default"] }, resultCarrier: int32Carrier },
    { exportId: `${m}::setExitCode`, operationKind: "method", target: { form: "call", path: "node_process::set_exit_code" }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [int32Carrier] },
  ];
}

// --- node:buffer -------------------------------------------------------------

function bufferModule(): RustProviderModuleDefinition {
  const m = "node:buffer";
  const bufferId = "node:buffer::Buffer";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.buffer",
    exports: [
      {
        id: bufferId,
        name: "Buffer",
        kind: "class" as const,
        members: [
          methodMember(bufferId, "from", [{ name: "value", type: stringType }, { name: "encoding", type: stringType }], providerRef(m, "Buffer"), { static: true }),
          methodMember(bufferId, "alloc", [{ name: "size", type: numberType }], providerRef(m, "Buffer"), { static: true }),
          methodMember(bufferId, "byteLength", [{ name: "value", type: stringType }, { name: "encoding", type: stringType }], numberType, { static: true }),
          methodMember(bufferId, "concat", [{ name: "list", type: { kind: "array", elementType: providerRef(m, "Buffer") } }], providerRef(m, "Buffer"), { static: true }),
          methodMember(bufferId, "toString", [{ name: "encoding", type: stringType }], stringType),
          methodMember(bufferId, "readUInt8", [{ name: "offset", type: numberType }], numberType),
          methodMember(bufferId, "writeUInt8", [{ name: "value", type: numberType }, { name: "offset", type: numberType }], voidType),
          methodMember(bufferId, "equals", [{ name: "other", type: providerRef(m, "Buffer") }], booleanType),
          methodMember(bufferId, "compare", [{ name: "other", type: providerRef(m, "Buffer") }], numberType),
          propertyMember(bufferId, "length", numberType),
        ],
      },
      fnExport(m, "isBuffer", [{ name: "value", type: providerRef(m, "Buffer") }], booleanType),
      unsupportedFn(m, "btoa", "the legacy base64 global contract"),
      unsupportedFn(m, "atob", "the legacy base64 global contract"),
    ],
  };
}

function bufferRows(): readonly RustProviderOperationRow[] {
  const bufferId = "node:buffer::Buffer";
  return [
    { exportId: bufferId, memberId: `${bufferId}.from`, operationKind: "method", target: { form: "call", path: "node_buffer::Buffer::from_string_enc", argModes: ["ref", "ref"] }, resultCarrier: bufferCarrier, parameterCarriers: [stringCarrier, stringCarrier], isFallible: true },
    { exportId: bufferId, memberId: `${bufferId}.alloc`, operationKind: "method", target: { form: "call", path: "node_buffer::Buffer::alloc", argCasts: ["usize"] }, resultCarrier: bufferCarrier, parameterCarriers: [int32Carrier] },
    { exportId: bufferId, memberId: `${bufferId}.byteLength`, operationKind: "method", target: { form: "call", path: "node_buffer::Buffer::byte_length_enc", argModes: ["ref", "ref"] }, resultCarrier: int32Carrier, parameterCarriers: [stringCarrier, stringCarrier], isFallible: true, castResult: "i32" },
    { exportId: bufferId, memberId: `${bufferId}.concat`, operationKind: "method", target: { form: "call", path: "node_buffer::Buffer::concat", argModes: ["ref"] }, resultCarrier: bufferCarrier },
    { exportId: bufferId, memberId: `${bufferId}.toString`, operationKind: "method", target: { form: "receiver-method", name: "to_string_enc", argModes: ["ref"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier], isFallible: true },
    { exportId: bufferId, memberId: `${bufferId}.readUInt8`, operationKind: "method", target: { form: "receiver-method", name: "read_u8", argCasts: ["usize"] }, resultCarrier: int32Carrier, parameterCarriers: [int32Carrier], isFallible: true, castResult: "i32" },
    { exportId: bufferId, memberId: `${bufferId}.writeUInt8`, operationKind: "method", target: { form: "receiver-method", name: "set", argOrder: [1, 0], argCasts: ["usize", "u8"], mutatesReceiver: true }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [int32Carrier, int32Carrier], isFallible: true },
    { exportId: bufferId, memberId: `${bufferId}.equals`, operationKind: "method", target: { form: "receiver-method", name: "equals", argModes: ["ref"] }, resultCarrier: boolCarrier, parameterCarriers: [bufferCarrier] },
    { exportId: bufferId, memberId: `${bufferId}.compare`, operationKind: "method", target: { form: "receiver-method", name: "compare", argModes: ["ref"] }, resultCarrier: int32Carrier, parameterCarriers: [bufferCarrier] },
    { exportId: bufferId, memberId: `${bufferId}.length`, operationKind: "property", target: { form: "receiver-method", name: "len" }, resultCarrier: int32Carrier, castResult: "i32" },
    { exportId: "node:buffer::isBuffer", operationKind: "method", target: { form: "call", path: "node_buffer::is_buffer", argModes: ["ref"] }, resultCarrier: boolCarrier, parameterCarriers: [bufferCarrier] },
  ];
}

// --- node:url ----------------------------------------------------------------

function urlModule(): RustProviderModuleDefinition {
  const m = "node:url";
  const urlId = "node:url::URL";
  const paramsId = "node:url::URLSearchParams";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.url",
    exports: [
      {
        id: urlId,
        name: "URL",
        kind: "class" as const,
        members: [
          constructorMember(urlId, [{ name: "input", type: stringType }]),
          propertyMember(urlId, "href", stringType),
          propertyMember(urlId, "protocol", stringType),
          propertyMember(urlId, "host", stringType),
          propertyMember(urlId, "hostname", stringType),
          propertyMember(urlId, "port", stringType),
          propertyMember(urlId, "pathname", stringType),
          propertyMember(urlId, "search", stringType),
          propertyMember(urlId, "hash", stringType),
          propertyMember(urlId, "origin", stringType),
        ],
      },
      {
        id: paramsId,
        name: "URLSearchParams",
        kind: "class" as const,
        members: [
          constructorMember(paramsId, [{ name: "init", type: stringType }]),
          // Contract: empty string when the parameter is absent.
          methodMember(paramsId, "get", [{ name: "name", type: stringType }], stringType),
          methodMember(paramsId, "set", [{ name: "name", type: stringType }, { name: "value", type: stringType }], voidType),
          methodMember(paramsId, "append", [{ name: "name", type: stringType }, { name: "value", type: stringType }], voidType),
          methodMember(paramsId, "has", [{ name: "name", type: stringType }], booleanType),
          methodMember(paramsId, "toString", [], stringType),
        ],
      },
      fnExport(m, "pathToFileURL", [{ name: "path", type: stringType }], providerRef(m, "URL")),
      fnExport(m, "fileURLToPath", [{ name: "url", type: providerRef(m, "URL") }], stringType),
      unsupportedFn(m, "parse", "the legacy URL object shape contract"),
      unsupportedFn(m, "format", "the legacy URL object shape contract"),
    ],
  };
}

function urlRows(): readonly RustProviderOperationRow[] {
  const urlId = "node:url::URL";
  const paramsId = "node:url::URLSearchParams";
  const urlProperty = (name: string): RustProviderOperationRow => ({
    exportId: urlId,
    memberId: `${urlId}.${name}`,
    operationKind: "property",
    target: { form: "receiver-method", name },
    resultCarrier: stringCarrier,
  });
  return [
    { exportId: urlId, operationKind: "constructor", target: { form: "call", path: "node_url::Url::parse", argModes: ["ref"], trailingArgs: ["None"] }, resultCarrier: urlCarrier, parameterCarriers: [stringCarrier], isFallible: true },
    ...["href", "protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin"].map(urlProperty),
    { exportId: paramsId, operationKind: "constructor", target: { form: "call", path: "node_url::UrlSearchParams::new_from", argModes: ["ref"] }, resultCarrier: searchParamsCarrier, parameterCarriers: [stringCarrier], isFallible: true },
    { exportId: paramsId, memberId: `${paramsId}.get`, operationKind: "method", target: { form: "receiver-method", name: "get", argModes: ["ref"], chain: ["unwrap_or_default"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier] },
    { exportId: paramsId, memberId: `${paramsId}.set`, operationKind: "method", target: { form: "receiver-method", name: "set", argModes: ["ref", "ref"], mutatesReceiver: true }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [stringCarrier, stringCarrier] },
    { exportId: paramsId, memberId: `${paramsId}.append`, operationKind: "method", target: { form: "receiver-method", name: "append", argModes: ["ref", "ref"], mutatesReceiver: true }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [stringCarrier, stringCarrier] },
    { exportId: paramsId, memberId: `${paramsId}.has`, operationKind: "method", target: { form: "receiver-method", name: "has", argModes: ["ref"] }, resultCarrier: boolCarrier, parameterCarriers: [stringCarrier] },
    { exportId: paramsId, memberId: `${paramsId}.toString`, operationKind: "method", target: { form: "receiver-method", name: "to_string" }, resultCarrier: stringCarrier },
    { exportId: "node:url::pathToFileURL", operationKind: "method", target: { form: "call", path: "node_url::path_to_file_url", argModes: ["ref"] }, resultCarrier: urlCarrier, parameterCarriers: [stringCarrier] },
    { exportId: "node:url::fileURLToPath", operationKind: "method", target: { form: "call", path: "node_url::file_url_to_path", argModes: ["ref"] }, resultCarrier: stringCarrier, parameterCarriers: [urlCarrier], isFallible: true },
  ];
}

// --- node:crypto -------------------------------------------------------------

function cryptoModule(): RustProviderModuleDefinition {
  const m = "node:crypto";
  const hashId = "node:crypto::Hash";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.crypto",
    exports: [
      fnExport(m, "randomUUID", [], stringType),
      fnExport(m, "createHash", [{ name: "algorithm", type: stringType }], providerRef(m, "Hash")),
      {
        id: hashId,
        name: "Hash",
        kind: "class" as const,
        members: [
          methodMember(hashId, "update", [{ name: "value", type: stringType }], voidType),
          methodMember(hashId, "digest", [{ name: "encoding", type: stringType }], stringType),
        ],
      },
      unsupportedFn(m, "createHmac", "a keyed-digest carrier contract"),
      unsupportedFn(m, "randomBytes", "a byte-array carrier contract"),
    ],
  };
}

function cryptoRows(): readonly RustProviderOperationRow[] {
  const hashId = "node:crypto::Hash";
  return [
    { exportId: "node:crypto::randomUUID", operationKind: "method", target: { form: "call", path: "node_crypto::random_uuid" }, resultCarrier: stringCarrier, isFallible: true },
    { exportId: "node:crypto::createHash", operationKind: "method", target: { form: "call", path: "node_crypto::create_hash", argModes: ["ref"] }, resultCarrier: hashCarrier, parameterCarriers: [stringCarrier], isFallible: true },
    { exportId: hashId, memberId: `${hashId}.update`, operationKind: "method", target: { form: "receiver-method", name: "update_str", argModes: ["ref"], mutatesReceiver: true }, resultCarrier: { kind: "tuple", elements: [] }, parameterCarriers: [stringCarrier], isFallible: true },
    { exportId: hashId, memberId: `${hashId}.digest`, operationKind: "method", target: { form: "receiver-method", name: "digest_string", argModes: ["ref"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier], isFallible: true },
  ];
}

// --- node:util ---------------------------------------------------------------

function utilModule(): RustProviderModuleDefinition {
  const m = "node:util";
  return {
    moduleSpecifier: m,
    providerModuleId: "tsonic.rust.node.util",
    exports: [
      fnExport(m, "stripVTControlCharacters", [{ name: "value", type: stringType }], stringType),
      fnExport(m, "toUSVString", [{ name: "value", type: stringType }], stringType),
      fnExport(m, "styleText", [{ name: "style", type: stringType }, { name: "text", type: stringType }], stringType),
      fnExport(m, "getSystemErrorName", [{ name: "code", type: numberType }], stringType),
      unsupportedFn(m, "inspect", "a deterministic closed inspection subset (open reflection is out of contract)"),
      unsupportedFn(m, "format", "a deterministic closed formatting subset (open reflection is out of contract)"),
    ],
  };
}

function utilRows(): readonly RustProviderOperationRow[] {
  const m = "node:util";
  return [
    { exportId: `${m}::stripVTControlCharacters`, operationKind: "method", target: { form: "call", path: "node_util::strip_vt_control_characters", argModes: ["ref"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier] },
    { exportId: `${m}::toUSVString`, operationKind: "method", target: { form: "call", path: "node_util::to_usv_string", argModes: ["ref"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier] },
    { exportId: `${m}::styleText`, operationKind: "method", target: { form: "call", path: "node_util::style_text", argModes: ["ref", "ref"] }, resultCarrier: stringCarrier, parameterCarriers: [stringCarrier, stringCarrier] },
    { exportId: `${m}::getSystemErrorName`, operationKind: "method", target: { form: "call", path: "node_util::get_system_error_name", chain: ["to_string"] }, resultCarrier: stringCarrier, parameterCarriers: [int32Carrier] },
  ];
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
      fsModule(),
      fsPromisesModule(),
      processModule(),
      bufferModule(),
      urlModule(),
      cryptoModule(),
      utilModule(),
    ],
    operations: [
      ...pathRows(),
      ...osRows(),
      ...fsRows(),
      ...fsPromisesRows(),
      ...processRows(),
      ...bufferRows(),
      ...urlRows(),
      ...cryptoRows(),
      ...utilRows(),
    ],
    crates: [{
      crateName: "tsonic_rust_node",
      cargoPath: resolve(targetPackageRoot, "../rust-nodejs/crates/tsonic_rust_node"),
    }],
  });
}
