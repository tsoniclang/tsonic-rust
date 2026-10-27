import type { RustTargetOperationFact } from "../records/operations/operations.js";

export function rustTargetOperationText(fact: RustTargetOperationFact): string {
  if (fact.kind === "provider-operation") {
    const target = fact.abi.target;
    if (target.form === "call" || target.form === "source-module-construction" ||
      target.form === "call-c-variadic" || target.form === "path" ||
      target.form === "reference-path" || target.form === "struct-variant" ||
      target.form === "expression-macro" || target.form === "static" || target.form === "free-call" ||
      target.form === "call-str-slice" || target.form === "free-call-str-slice" ||
      target.form === "call-value-slice" || target.form === "call-value-array") {
      return target.path;
    }
    if (target.form === "index") {
      return "[]";
    }
    if (target.form === "marker") {
      return "marker";
    }
    if (target.form === "numeric-cast") {
      return `numeric-cast:${target.target}`;
    }
    if (target.form === "binary-operator") {
      return target.operator;
    }
    if (target.form === "trait-call") {
      return `${target.traitPath}::${target.method}`;
    }
    if (target.form === "trait-associated-value") {
      return `${target.traitPath}::${target.name}`;
    }
    if (target.form === "associated-value") {
      return `${JSON.stringify(target.owner)}::${target.name}`;
    }
    if (target.form === "associated-call") {
      return `${JSON.stringify(target.owner)}::${target.method}`;
    }
    if (target.form === "arg-structural-method") {
      return `structural-method[${target.storageIndex}]`;
    }
    if (target.form === "native-promise-continuation") {
      return `native-promise.${target.member}`;
    }
    return target.name;
  }
  if (fact.kind === "operator-token" || fact.kind === "operator-call") {
    return fact.operator;
  }
  if (fact.kind === "string-concat") {
    return "+";
  }
  if (fact.kind === "sequence" || fact.kind === "conditional" || fact.kind === "identity-expression" ||
    fact.kind === "non-null-expression" ||
    fact.kind === "template-string" || fact.kind === "typeof" ||
    fact.kind === "void-expression") {
    return fact.operationId;
  }
  if (fact.kind === "switch") {
    return fact.operationId;
  }
  if (fact.kind === "source-conversion") {
    return fact.conversion === undefined ? "identity" : "runtime-conversion";
  }
  if (fact.kind === "project-type-test" || fact.kind === "program-error-type-test" ||
    fact.kind === "closed-type-test") {
    return fact.kind;
  }
  return fact.operationId;
}
