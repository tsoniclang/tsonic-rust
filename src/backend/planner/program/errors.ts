import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import { rustRuntimeErrorTypeIdentity } from "./source-package-errors.js";
import { rustTypeFromCarrier } from "../types/render.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  compareRustSemanticKeys,
  rustTypeSemanticKey,
} from "../../../target-model/semantics/index.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import {
  createRustSourceFile,
  emptyRustAstGenerics,
  type RustExpr,
  type RustItem,
  type RustPattern,
  type RustSourceFileModel,
  type RustType,
} from "../../target-ast/nodes.js";
import { rustDocHiddenAttribute, rustDeriveAttribute } from "../../target-ast/attributes.js";
import { rustGenerics, rustTypeGenericArguments, rustTypeParameter } from "../../target-ast/builders.js";

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
function namedType(path: string, typeArguments?: readonly RustType[]): RustType {
  return {
    kind: "named",
    path,
    ...(typeArguments === undefined
      ? {}
      : { genericArguments: rustTypeGenericArguments(typeArguments) }),
  };
}

function resultType(value: RustType): RustType {
  return namedType(programResultName, [value]);
}

function completionType(value: RustType): RustType {
  return namedType("Completion", [value]);
}

function boxType(value: RustType): RustType {
  return namedType("Box", [value]);
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
  const definitions = domain.definitions;
  const externalPackageErrors = domain.externalErrors;
  if (definitions.length === 0 && externalPackageErrors.length === 0) {
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
  const providerErrorTypeKeys = new Set([
    closedMetadataKey(runtimeErrorType),
    closedMetadataKey(runtimeJsErrorType),
  ]);
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
          `carrier=${rustTypeSemanticKey(carrier)}`,
        ],
      });
      continue;
    }
    const key = closedMetadataKey(type);
    if (!providerErrorTypeKeys.has(key)) {
      providerErrorTypeKeys.add(key);
      providerErrorTypes.push(type);
    }
  }
  providerErrorTypes.sort((left, right) => compareRustSemanticKeys(
    closedMetadataKey(left),
    closedMetadataKey(right),
  ));
  if (diagnostics.length > 0) {
    return undefined;
  }

  const items: RustItem[] = [
    {
      kind: "use",
      visibility: "public",
      path: "tsonic_rust_runtime::*",
    },
    {
      kind: "enum",
      name: programErrorName,
      visibility: "public",
      attrs: [rustDocHiddenAttribute, rustDeriveAttribute("Clone")],
      generics: emptyRustAstGenerics,
      variants: [
        tupleEnumVariant("Runtime", runtimeErrorType),
        ...exactProjectVariants.map(({ variant, type }) => tupleEnumVariant(variant, type)),
        ...externalVariants.map(({ variant, type }) => tupleEnumVariant(variant, type)),
        {
          name: "Suppressed",
          fields: {
            kind: "tuple",
            fields: [boxType(programErrorType), boxType(programErrorType)].map((type) => ({
              type,
              visibility: "private",
            })),
          },
        },
      ],
    },
    {
      kind: "type-alias",
      name: programResultName,
      visibility: "public",
      generics: rustGenerics([rustTypeParameter("T")]),
      target: namedType("Result", [typeParameterT, programErrorType]),
    },
    fromImplementation(runtimeErrorType, "Runtime", false),
    fromImplementation(runtimeJsErrorType, "Runtime", true),
    ...providerErrorTypes.map((type) => fromImplementation(type, "Runtime", true)),
    ...exactProjectVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    ...externalVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    displayImplementation([
      ...exactProjectVariants.map(({ variant }) => variant),
      ...externalVariants.map(({ variant }) => variant),
    ]),
    debugImplementation(),
    {
      kind: "impl",
      generics: emptyRustAstGenerics,
      trait: namedType("std::error::Error"),
      target: programErrorType,
      polarity: "positive",
      safety: "safe",
      functions: [],
      associatedTypes: [],
      associatedConstants: [],
    },
    sourceStringImplementation(),
    finishResourceFunction(),
    finishFinallyFunction(),
  ];
  return createRustSourceFile(items);
}

function tupleEnumVariant(
  name: string,
  ...types: readonly RustType[]
): Extract<RustItem, { readonly kind: "enum" }>["variants"][number] {
  return {
    name,
    fields: {
      kind: "tuple",
      fields: types.map((type) => ({ type, visibility: "private" })),
    },
  };
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
    generics: emptyRustAstGenerics,
    trait: namedType("std::convert::From", [source]),
    target: programErrorType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "from",
      visibility: "private",
      generics: emptyRustAstGenerics,
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

function displayImplementation(projectVariants: readonly string[]): RustItem {
  const formatterType: RustType = {
    kind: "reference",
    mutable: true,
    referent: {
      kind: "named",
      path: "std::fmt::Formatter",
              genericArguments: [{ kind: "lifetime", lifetime: { kind: "inferred" } }],
    },
  };
  return {
    kind: "impl",
    generics: emptyRustAstGenerics,
    trait: namedType("std::fmt::Display"),
    target: programErrorType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "fmt",
      visibility: "private",
      generics: emptyRustAstGenerics,
      receiver: { kind: "reference", mutable: false },
      params: [{ name: "formatter", type: formatterType }],
      returnType: namedType("std::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "match",
            expression: path("self"),
            arms: [
              displayDelegateArm("Self::Runtime"),
              ...projectVariants.map((variant) =>
                displayDelegateArm(`Self::${variant}`)),
              {
                pattern: tupleVariant(
                  "Self::Suppressed",
                  binding("error"),
                  binding("suppressed"),
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
    expression: call("std::fmt::Display::fmt", path("value"), path("formatter")),
  };
}

function debugImplementation(): RustItem {
  return {
    kind: "impl",
    generics: emptyRustAstGenerics,
    trait: namedType("std::fmt::Debug"),
    target: programErrorType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "fmt",
      visibility: "private",
      generics: emptyRustAstGenerics,
      receiver: { kind: "reference", mutable: false },
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "std::fmt::Formatter",
            genericArguments: [{ kind: "lifetime", lifetime: { kind: "inferred" } }],
          },
        },
      }],
      returnType: namedType("std::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: call("std::fmt::Display::fmt", path("self"), path("formatter")),
        }],
      },
    }],
  };
}

function sourceStringImplementation(): RustItem {
  return {
    kind: "impl",
    generics: emptyRustAstGenerics,
    trait: namedType("tsonic_rust_runtime::ToSourceString"),
    target: programErrorType,
    polarity: "positive",
    safety: "safe",
    associatedTypes: [],
    associatedConstants: [],
    functions: [{
      name: "to_source_string",
      visibility: "private",
      generics: emptyRustAstGenerics,
      receiver: { kind: "reference", mutable: false },
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
  const completion = completionType(typeParameterT);
  return {
    kind: "function",
    name: "finish_resource",
    visibility: "public",
    attrs: [rustDocHiddenAttribute],
    generics: rustGenerics([rustTypeParameter("T")]),
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
                  "TsonicError::Suppressed",
                  call("Box::new", path("error")),
                  call("Box::new", path("suppressed")),
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
  const completion = completionType(typeParameterT);
  return {
    kind: "function",
    name: "finish_finally",
    visibility: "public",
    attrs: [rustDocHiddenAttribute],
    generics: rustGenerics([rustTypeParameter("T")]),
    params: [
      { name: "body", type: resultType(completion) },
      { name: "finally", type: resultType(completion) },
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
              pattern: tupleVariant("Ok", { kind: "path", path: "Completion::Normal" }),
              expression: path("body"),
            },
            {
              pattern: tupleVariant("Ok", binding("completion")),
              expression: call("Ok", path("completion")),
            },
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
