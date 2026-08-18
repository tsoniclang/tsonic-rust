import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustPlanningContext } from "../context.js";
import {
  createRustSourceFile,
  type RustExpr,
  type RustItem,
  type RustPattern,
  type RustSourceFileModel,
  type RustType,
} from "../../rust-ast/nodes.js";

const programErrorName = "TsonicError";
const programResultName = "TsonicResult";

const programErrorType: RustType = { kind: "named", path: programErrorName };
const runtimeErrorType: RustType = {
  kind: "named",
  path: "tsonic_rust_runtime::TsonicError",
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
    ...(typeArguments === undefined ? {} : { typeArguments }),
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
  diagnostics: TargetDiagnostic[],
): RustSourceFileModel | undefined {
  const definitions = input.projectTypes.programErrorDefinitions;
  if (definitions.length === 0) {
    return undefined;
  }

  const projectVariants = definitions.map((definition) => {
    const variant = input.projectTypes.programErrorVariant(definition);
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
      attrs: ["#[doc(hidden)]"],
      derives: ["Clone"],
      variants: [
        { name: "Runtime", fields: [runtimeErrorType] },
        ...exactProjectVariants.map(({ variant, type }) => ({ name: variant, fields: [type] })),
        {
          name: "Suppressed",
          fields: [boxType(programErrorType), boxType(programErrorType)],
        },
      ],
    },
    {
      kind: "type-alias",
      name: programResultName,
      visibility: "public",
      typeParams: [{ name: "T", bounds: [] }],
      target: namedType("Result", [typeParameterT, programErrorType]),
    },
    fromImplementation(runtimeErrorType, "Runtime", false),
    fromImplementation(runtimeJsErrorType, "Runtime", true),
    ...exactProjectVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    displayImplementation(exactProjectVariants.map(({ variant }) => variant)),
    debugImplementation(),
    {
      kind: "impl",
      trait: namedType("std::error::Error"),
      target: programErrorType,
      functions: [],
    },
    sourceStringImplementation(),
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
    trait: namedType("std::convert::From", [source]),
    target: programErrorType,
    functions: [{
      name: "from",
      visibility: "private",
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
      lifetimeArguments: ["_"],
    },
  };
  return {
    kind: "impl",
    trait: namedType("std::fmt::Display"),
    target: programErrorType,
    functions: [{
      name: "fmt",
      visibility: "private",
      selfParam: "ref",
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
    trait: namedType("std::fmt::Debug"),
    target: programErrorType,
    functions: [{
      name: "fmt",
      visibility: "private",
      selfParam: "ref",
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "std::fmt::Formatter",
            lifetimeArguments: ["_"],
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
    trait: namedType("tsonic_rust_runtime::ToSourceString"),
    target: programErrorType,
    functions: [{
      name: "to_source_string",
      visibility: "private",
      selfParam: "ref",
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
    attrs: ["#[doc(hidden)]"],
    typeParams: [{ name: "T", bounds: [] }],
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
    attrs: ["#[doc(hidden)]"],
    typeParams: [{ name: "T", bounds: [] }],
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
