import { rustHiddenAttribute } from "../../target-ast/attributes.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { rustRuntimeErrorTypeIdentity } from "./source-package-errors.js";
import { rustTypeFromCarrier } from "../types/render.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustTsValueTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  createRustSourceFile,
  type RustExpr,
  type RustItem,
  type RustPattern,
  type RustSourceFileModel,
  type RustType,
  type RustGenerics,
} from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import { planRustErrorObservations, planRustSuppressedErrorConstructor } from "./error-observations.js";
import { planRustErrorTransport, planRustSourceErrorTransport, rustSuppressedErrorPattern,
  type RustErrorTransportVariant } from "./error-transport.js";
import { planRustSourceErrorObservations } from "./source-error-observations.js";
import { planRustRetainedErrorAdmission } from "./retained-errors.js";
import { planRustErrorProjectionTransport, planRustSourceErrorProjectionDelegates } from "./error-projections.js";
import { planRustClosedThrowAdmission } from "./closed-throws.js";
import { planRustNativeValueProjections } from "./native-value-projections.js";
import { planRustErrorVariants } from "./error-variants.js";

const programErrorName = "TsonicError";
const programResultName = "TsonicResult";

const programErrorType: RustType = { kind: "named", path: programErrorName };
const runtimeErrorType: RustType = {
  kind: "named",
  path: "tsonic_rust_runtime::TsonicError",
  identity: rustRuntimeErrorTypeIdentity,
};
const runtimeJsErrorType: RustType = {
  kind: "named",
  path: "tsonic_rust_runtime::JsError",
};
const unitType: RustType = { kind: "unit" };
const typeParameterT: RustType = { kind: "named", path: "T" };
const typeParameterNormal: RustType = { kind: "named", path: "TNormal" };
function namedType(path: string, typeArguments?: readonly RustType[]): RustType {
  return {
    kind: "named",
    path,
    ...(typeArguments === undefined
      ? {}
      : { genericArguments: typeArguments.map((type) => ({ kind: "type" as const, type })) }),
  };
}

const oneTypeParameterGenerics = Object.freeze({
  parameters: Object.freeze([{ kind: "type" as const, name: "T", bounds: Object.freeze([]) }]),
  wherePredicates: Object.freeze([]),
});

const completionGenerics = Object.freeze({
  parameters: Object.freeze([
    { kind: "type" as const, name: "T", bounds: Object.freeze([]) },
    { kind: "type" as const, name: "TNormal", bounds: Object.freeze([]) },
  ]),
  wherePredicates: Object.freeze([]),
});

function resultType(value: RustType): RustType {
  return namedType(programResultName, [value]);
}

function completionType(value: RustType, normal: RustType): RustType {
  return namedType("Completion", [value, normal]);
}

function binding(name: string): RustPattern {
  return { kind: "binding", name };
}

function tupleVariant(path: string, ...elements: readonly RustPattern[]): RustPattern {
  return { kind: "tuple-variant", path, elements };
}

function call(path: string, ...args: readonly RustExpr[]): RustExpr {
  return { kind: "call", path, args };
}

function path(name: string): RustExpr {
  return { kind: "path", path: name };
}

export function planRustProgramErrorModule(
  input: RustPlanningContext,
  moduleNameByFileName: ReadonlyMap<string, string>,
  domain: import("./source-package-errors.js").RustSourcePackageErrorDomainPlan,
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  if (domain.forwardModulePath !== undefined) {
    return createRustSourceFile([{
      kind: "use", visibility: "public", path: `${domain.forwardModulePath}::*`,
    }]);
  }
  const definitions = domain.definitions;
  const externalPackageErrors = domain.externalErrors;
  if (domain.errorDomain !== "project") {
    return undefined;
  }

  const projectVariants = definitions.map((definition) => {
    const variant = input.program.projectTypes.programErrorVariant(definition);
    const moduleName = moduleNameByFileName.get(definition.fileName);
    if (variant === undefined || moduleName === undefined) {
      diagnostics.push({
        code: "RUST_PROGRAM_ERROR_IDENTITY_MISSING",
        category: "error",
        source: "tsonic-rust",
        message: `Project error '${definition.sourceName}' has no exact generated module or variant identity.`,
        sourceNode: definition.declaration,
        evidence: ["target.capability=rust.error.closed-program-transport"],
      });
      return undefined;
    }
    return Object.freeze({
      definition,
      variant,
      type: namedType(`crate::${moduleName}::${definition.targetName}`),
    });
  });
  if (projectVariants.some((variant) => variant === undefined)) {
    return undefined;
  }
  const exactProjectVariants = projectVariants.filter((variant) => variant !== undefined);
  const externalVariants = externalPackageErrors.map((external) => Object.freeze({
    ...external,
    type: namedType(external.typePath),
  }));
  const providerErrorTypes: RustType[] = [];
  for (const carrier of input.program.providerErrorCarriers) {
    if (rustTargetTypeRefEquals(carrier, rustJsErrorTargetType()) ||
      rustTargetTypeRefEquals(carrier, rustProgramErrorTargetType())) {
      continue;
    }
    const type = rustTypeFromCarrier(carrier);
    if (type === undefined) {
      diagnostics.push({
        code: "RUST_PROVIDER_ERROR_CARRIER_UNRENDERABLE",
        category: "error",
        source: "tsonic-rust",
        message: "A selected provider-native error carrier has no exact renderable Rust type.",
        evidence: [
          "target.capability=rust.error.provider-conversion",
          `carrier=${JSON.stringify(carrier)}`,
        ],
      });
      continue;
    }
    if (![runtimeErrorType, runtimeJsErrorType, ...providerErrorTypes].some((existing) =>
      JSON.stringify(existing) === JSON.stringify(type))) {
      providerErrorTypes.push(type);
    }
  }
  providerErrorTypes.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  if (diagnostics.length > 0) {
    return undefined;
  }

  const selectedVariants = planRustErrorVariants(input.program, domain);
  if (selectedVariants === undefined) {
    diagnostics.push({ code: "RUST_CLOSED_ERROR_DEMAND_MISSING", category: "error", source: "tsonic-rust",
      message: "Program Error transport requires its exact sealed variant inventory." });
    return undefined;
  }
  const nativeProjectVariants = exactProjectVariants.map(variant => ({
    name: variant.variant, representation: input.program.objectRepresentations.representationFor(variant.definition),
  }));
  if (nativeProjectVariants.some(variant => variant.representation === undefined)) {
    diagnostics.push({ code: "RUST_PROGRAM_ERROR_REPRESENTATION_MISSING", category: "error", source: "tsonic-rust",
      message: "Native thrown-value queries require exact finalized project storage." });
    return undefined;
  }
  const closedVariants: RustErrorTransportVariant[] = [];
  const projectVariantByDefinition = new Map(exactProjectVariants.map(variant => [variant.definition, variant] as const));
  const transportVariants: RustErrorTransportVariant[] = [];
  for (const selected of selectedVariants) {
    if (selected.kind === "project") {
      const variant = projectVariantByDefinition.get(selected.definition);
      if (variant === undefined) return undefined;
      transportVariants.push({ name: selected.name, type: variant.type,
        source: selected.sourceError ? "error" : "thrown" });
    } else if (selected.kind === "external") {
      transportVariants.push({ name: selected.name, type: namedType(selected.external.typePath), source: "external",
        sourceErrorType: namedType(`${selected.external.typePath.slice(0, -programErrorName.length)}SourceError`),
        writableSourceErrorType: namedType(`${selected.external.typePath.slice(0, -programErrorName.length)}WritableSourceError`) });
    } else if (selected.kind === "closed") {
      const variant = { name: selected.name, source: "thrown" as const,
        type: namedType(rustTargetTypeRefEquals(selected.carrier, rustTsValueTargetType())
          ? "tsonic_rust_runtime::TsValue" : "tsonic_rust_js::value::JsValue") };
      closedVariants.push(variant);
      transportVariants.push(variant);
    } else {
      transportVariants.push({ name: selected.name, type: namedType("tsonic_rust_runtime::RetainedError"), source: "external",
        sourceErrorType: namedType("tsonic_rust_runtime::RetainedError"),
        writableSourceErrorType: namedType("tsonic_rust_runtime::WritableRetainedError") });
    }
  }
  const transport = planRustErrorTransport(transportVariants);
  if (transport === undefined) {
    diagnostics.push({ code: "RUST_ERROR_TRANSPORT_ADMISSION_NOT_CLOSED", category: "error", source: "tsonic-rust",
      message: "Program Error transport has no exact unique variant admission and external Error-only specialization." });
    return undefined;
  }
  const items: RustItem[] = [
    {
      kind: "use",
      visibility: "public",
      path: "tsonic_rust_runtime::*",
    },
    transport.declaration,
    ...transport.aliases,
    {
      kind: "type-alias",
      name: programResultName,
      visibility: "public",
      generics: oneTypeParameterGenerics,
      target: namedType("Result", [typeParameterT, programErrorType]),
    },
    fromImplementation(runtimeErrorType, "Runtime", false),
    fromImplementation(runtimeJsErrorType, "Runtime", true),
    fromImplementation(namedType("tsonic_rust_runtime::MutableJsError"), "SourceCreated", false),
    ...providerErrorTypes.map((type) => fromImplementation(type, "Runtime", true)),
    ...exactProjectVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    ...externalVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    ...transport.variants.filter(variant => variant.name === "Retained").map(variant =>
      fromImplementation(variant.type, variant.name, false)),
    ...planRustClosedThrowAdmission(closedVariants),
    planRustNativeValueProjections([...closedVariants.map(variant => variant.name),
      ...externalVariants.map(variant => variant.variant)], nativeProjectVariants.map(variant => ({
      name: variant.name, representation: variant.representation!,
    }))),
    displayImplementation(programErrorType, emptyRustGenerics, [
      ...exactProjectVariants.map(({ variant, definition }) => ({
        variant,
        delegate: input.program.projectTypes.inheritedExternalBaseForDefinition(definition)?.base.programError === true,
      })),
      ...externalVariants.map(({ variant }) => ({ variant, delegate: true })),
      ...transport.variants.filter(variant => variant.name === "Retained").map(({ name }) => ({ variant: name, delegate: true })),
      ...closedVariants.map(({ name }) => ({ variant: name, delegate: false })),
    ]),
    debugImplementation(programErrorType, emptyRustGenerics),
    {
      kind: "impl",
      generics: emptyRustGenerics,
      trait: namedType("core::error::Error"),
      target: programErrorType,
      members: [],
    },
    sourceStringImplementation(programErrorType, emptyRustGenerics),
    planRustSuppressedErrorConstructor(),
    planRustErrorObservations(transport),
    ...planRustSourceErrorTransport(transport),
    ...planRustSourceErrorTransport(transport, true),
    ...planRustSourceErrorObservations(transport),
    ...planRustSourceErrorObservations(transport, true),
    ...planRustRetainedErrorAdmission(transport),
    ...planRustErrorProjectionTransport(transport),
    ...planRustSourceErrorProjectionDelegates(),
    finishResourceFunction(),
    finishFinallyFunction(),
  ];
  return createRustSourceFile(items);
}

function fromImplementation(
  source: RustType,
  variant: string,
  wrapRuntime: boolean,
): RustItem {
  const value = path("value");
  const payload = wrapRuntime
    ? call("tsonic_rust_runtime::TsonicError::from", value)
    : value;
  return {
    kind: "impl",
    generics: emptyRustGenerics,
    trait: namedType("core::convert::From", [source]),
    target: programErrorType,
    members: [{ kind: "function",
      name: "from",
      visibility: "private",
      generics: emptyRustGenerics,
      params: [{ name: "value", type: source }],
      returnType: namedType("Self"),
      body: {
        statements: [{
          kind: "tail",
          expr: call(`Self::${variant}`, payload),
        }],
      },
    }],
  };
}

function displayImplementation(target: RustType, generics: RustGenerics, projectVariants: readonly {
  readonly variant: string;
  readonly delegate: boolean;
}[]): RustItem {
  const formatterType: RustType = {
    kind: "reference",
    mutable: true,
    referent: {
      kind: "named",
      path: "core::fmt::Formatter",
      genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
    },
  };
  return {
    kind: "impl",
    generics,
    trait: namedType("core::fmt::Display"),
    target,
    members: [{ kind: "function",
      name: "fmt",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{ name: "formatter", type: formatterType }],
      returnType: namedType("core::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "match",
            expression: path("self"),
            arms: [
              displayDelegateArm("Self::Runtime"),
              displayDelegateArm("Self::SourceCreated"),
              ...projectVariants.map(({ variant, delegate }) => delegate
                ? displayDelegateArm(`Self::${variant}`)
                : {
                    pattern: tupleVariant(`Self::${variant}`, { kind: "wildcard" }),
                    expression: {
                      kind: "method-call" as const,
                      receiver: path("formatter"),
                      method: "write_str",
                      args: [{ kind: "str-literal" as const, value: "[object Object]" }],
                    },
                  }),
              {
                pattern: rustSuppressedErrorPattern(
                  false,
                  binding("error"),
                  binding("suppressed"),
                  { kind: "wildcard" },
                ),
                expression: {
                  kind: "format-write",
                  writer: path("formatter"),
                  format: "SuppressedError: {}; suppressed: {}",
                  args: [path("error"), path("suppressed")],
                },
              },
            ],
          },
        }],
      },
    }],
  };
}

function displayDelegateArm(variant: string): {
  readonly pattern: RustPattern;
  readonly expression: RustExpr;
} {
  return {
    pattern: tupleVariant(variant, binding("value")),
    expression: call("core::fmt::Display::fmt", path("value"), path("formatter")),
  };
}

function debugImplementation(target: RustType, generics: RustGenerics): RustItem {
  return {
    kind: "impl",
    generics,
    trait: namedType("core::fmt::Debug"),
    target,
    members: [{ kind: "function",
      name: "fmt",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "core::fmt::Formatter",
            genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
          },
        },
      }],
      returnType: namedType("core::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: call("core::fmt::Display::fmt", path("self"), path("formatter")),
        }],
      },
    }],
  };
}

function sourceStringImplementation(target: RustType, generics: RustGenerics): RustItem {
  return {
    kind: "impl",
    generics,
    trait: namedType("tsonic_rust_runtime::ToSourceString"),
    target,
    members: [{ kind: "function",
      name: "to_source_string",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [],
      returnType: { kind: "string" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "method-call",
            receiver: path("self"),
            method: "to_string",
            args: [],
          },
        }],
      },
    }],
  };
}

function finishResourceFunction(): RustItem {
  const completion = completionType(typeParameterT, typeParameterNormal);
  return {
    kind: "function",
    name: "finish_resource",
    visibility: "public",
    attrs: [rustHiddenAttribute],
    generics: completionGenerics,
    params: [
      { name: "body", type: resultType(completion) },
      { name: "cleanup", type: resultType(unitType) },
    ],
    returnType: resultType(completion),
    body: {
      statements: [{
        kind: "tail",
        expr: {
          kind: "match",
          expression: { kind: "tuple-literal", elements: [path("body"), path("cleanup")] },
          arms: [
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Ok", binding("completion")),
                  tupleVariant("Ok", { kind: "path", path: "()" }),
                ],
              },
              expression: call("Ok", path("completion")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Ok", { kind: "wildcard" }),
                  tupleVariant("Err", binding("error")),
                ],
              },
              expression: call("Err", path("error")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Err", binding("error")),
                  tupleVariant("Ok", { kind: "path", path: "()" }),
                ],
              },
              expression: call("Err", path("error")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Err", binding("suppressed")),
                  tupleVariant("Err", binding("error")),
                ],
              },
              expression: call(
                "Err",
                call(
                  "TsonicError::suppressed",
                  path("error"),
                  path("suppressed"),
                ),
              ),
            },
          ],
        },
      }],
    },
  };
}

function finishFinallyFunction(): RustItem {
  const completion = completionType(typeParameterT, typeParameterNormal);
  return {
    kind: "function",
    name: "finish_finally",
    visibility: "public",
    attrs: [rustHiddenAttribute],
    generics: completionGenerics,
    params: [
      { name: "body", type: resultType(completion) },
      { name: "finally", type: resultType(completionType(typeParameterT, unitType)) },
    ],
    returnType: resultType(completion),
    body: {
      statements: [{
        kind: "tail",
        expr: {
          kind: "match",
          expression: path("finally"),
          arms: [
            {
              pattern: tupleVariant("Ok", tupleVariant("Completion::Normal", { kind: "path", path: "()" })),
              expression: path("body"),
            },
            ...["Return", "Break", "Continue"].map(name => ({
              pattern: tupleVariant("Ok", tupleVariant(`Completion::${name}`, binding("value"))),
              expression: call("Ok", call(`Completion::${name}`, path("value"))),
            })),
            {
              pattern: tupleVariant("Err", binding("error")),
              expression: call("Err", path("error")),
            },
          ],
        },
      }],
    },
  };
}
