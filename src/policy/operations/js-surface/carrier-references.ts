import {
  rustJsArrayEntriesTargetType,
  rustJsArrayEntryTargetType,
} from "../../../target-model/types/carriers/array-entries.js";
import { rustIteratorResultTargetType } from "../../../target-model/types/index.js";
import {
  rustBigIntTargetType,
  rustEmptyObjectTargetType,
  rustJsNumericTargetType,
  isRustJsArrayCarrier,
  rustJsArrayLikeElementTargetType,
  rustJsValueTargetType,
  rustJsStringTargetType,
  rustVecTargetType,
  isRustNumericCarrier,
  rustJsDateTargetId,
  rustJsArrayBufferTargetType,
  rustJsSymbolTargetType,
  rustJsTypedArrayTargetType,
  rustFutureOutputCarrier,
  rustJsPromiseSettledResultTargetType,
  rustJsPromiseTargetType,
  rustJsRegExpExecArrayTargetType,
  rustJsRegExpIndicesTargetType,
  rustJsRegExpMatchArrayTargetType,
  rustJsRegExpNamedGroupsTargetType,
  rustJsRegExpNamedIndicesTargetType,
  rustJsRegExpStringIteratorTargetType,
  rustJsRegExpTargetType,
  rustRegExpExecArrayTargetType,
  rustRegExpIndicesTargetType,
  rustRegExpMatchArrayTargetType,
  rustRegExpNamedGroupsTargetType,
  rustRegExpNamedIndicesTargetType,
  rustRegExpStringIteratorTargetType,
  rustJsArrayTargetType,
  rustCallableTargetType,
  rustClosureTargetType,
  rustAbsenceTargetType,
  rustOptionTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../../../target-model/types/index.js";
import { rustInferCarrier } from "./rows.js";
import { rustJsIntlGroupingTargetId } from "../../../target-model/types/carriers/source-types.js";
import type { JsCarrierRef } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface JsLaneBindings {
  readonly element?: TargetTypeRef;
  readonly mapKey?: TargetTypeRef;
  readonly mapValue?: TargetTypeRef;
  readonly setValue?: TargetTypeRef;
  readonly weakKey?: TargetTypeRef;
  readonly weakValue?: TargetTypeRef;
  readonly sourceResult?: TargetTypeRef;
  readonly promiseOutput?: TargetTypeRef;
  readonly promiseInputOutput?: TargetTypeRef;
  readonly receiver?: TargetTypeRef;
  readonly selectedMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly authoredMethodTypeArguments?: readonly (TargetTypeRef | undefined)[];
  readonly arguments?: readonly (TargetTypeRef | undefined)[];
}

export function resolveCarrierRef(reference: JsCarrierRef, bindings: JsLaneBindings): TargetTypeRef | undefined {
  switch (reference.ref) {
    case "cb-array-from-map": {
      const source = bindings.selectedMethodTypeArguments?.[0];
      const result = bindings.authoredMethodTypeArguments?.[1] ?? rustInferCarrier;
      const args = [source, rustSourcePrimitiveTargetType("native-uint")].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], result);
    }
    case "cb-array-predicate":
      return arrayCallbackCarrier(bindings, reference.arity, rustSourcePrimitiveTargetType("bool"));
    case "cb-array-map":
      return arrayCallbackCarrier(
        bindings,
        reference.arity,
        bindings.authoredMethodTypeArguments?.[0] ?? rustInferCarrier,
      );
    case "cb-array-for-each":
      return arrayCallbackCarrier(bindings, reference.arity, rustUnitTargetType());
    case "cb-array-comparator": {
      const args = [bindings.element, bindings.element].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(
            args as TargetTypeRef[],
            rustSourcePrimitiveTargetType("float64"),
          );
    }
    case "cb-array-reduce":
      return arrayReduceCallbackCarrier(bindings, reference.arity, rustInferCarrier);
    case "cb-array-reduce-first":
      return bindings.element === undefined
        ? undefined
        : arrayReduceCallbackCarrier(bindings, reference.arity, bindings.element);
    case "cb-map-for-each": {
      const args = [bindings.mapValue, bindings.mapKey, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
    case "cb-set-for-each": {
      const args = [bindings.setValue, bindings.setValue, bindings.receiver].slice(0, reference.arity);
      return args.some((argument) => argument === undefined)
        ? undefined
        : rustClosureTargetType(args as TargetTypeRef[], rustUnitTargetType());
    }
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "uint64":
    case "native-int":
    case "native-uint":
    case "float32":
      return rustSourcePrimitiveTargetType(reference.ref);
    case "jsvalue":
      return rustJsValueTargetType();
    case "string-array":
      return rustJsArrayTargetType(rustStringTargetType());
    case "optional-string-array":
      return rustJsArrayTargetType(rustOptionTargetType(rustStringTargetType()));
    case "js-string-array":
      return rustJsArrayTargetType(rustJsStringTargetType());
    case "optional-js-string-array":
      return rustJsArrayTargetType(rustOptionTargetType(rustJsStringTargetType()));
    case "regexp":
      return rustJsRegExpTargetType();
    case "regexp-exec-array":
      return rustRegExpExecArrayTargetType();
    case "regexp-match-array":
      return rustRegExpMatchArrayTargetType();
    case "regexp-indices":
      return rustRegExpIndicesTargetType();
    case "regexp-named-groups":
      return rustRegExpNamedGroupsTargetType();
    case "regexp-named-indices":
      return rustRegExpNamedIndicesTargetType();
    case "regexp-string-iterator":
      return rustRegExpStringIteratorTargetType();
    case "js-regexp-exec-array":
      return rustJsRegExpExecArrayTargetType();
    case "js-regexp-match-array":
      return rustJsRegExpMatchArrayTargetType();
    case "js-regexp-indices":
      return rustJsRegExpIndicesTargetType();
    case "js-regexp-named-groups":
      return rustJsRegExpNamedGroupsTargetType();
    case "js-regexp-named-indices":
      return rustJsRegExpNamedIndicesTargetType();
    case "js-regexp-string-iterator":
      return rustJsRegExpStringIteratorTargetType();
    case "regexp-index-pair":
      return regexpIndexPairTargetType();
    case "option-of-regexp-exec-array":
      return rustOptionTargetType(rustRegExpExecArrayTargetType());
    case "option-of-regexp-match-array":
      return rustOptionTargetType(rustRegExpMatchArrayTargetType());
    case "option-of-regexp-indices":
      return rustOptionTargetType(rustRegExpIndicesTargetType());
    case "option-of-regexp-named-groups":
      return rustOptionTargetType(rustRegExpNamedGroupsTargetType());
    case "option-of-regexp-named-indices":
      return rustOptionTargetType(rustRegExpNamedIndicesTargetType());
    case "option-of-js-regexp-exec-array":
      return rustOptionTargetType(rustJsRegExpExecArrayTargetType());
    case "option-of-js-regexp-match-array":
      return rustOptionTargetType(rustJsRegExpMatchArrayTargetType());
    case "option-of-js-regexp-indices":
      return rustOptionTargetType(rustJsRegExpIndicesTargetType());
    case "option-of-js-regexp-named-groups":
      return rustOptionTargetType(rustJsRegExpNamedGroupsTargetType());
    case "option-of-js-regexp-named-indices":
      return rustOptionTargetType(rustJsRegExpNamedIndicesTargetType());
    case "option-of-regexp-index-pair":
      return rustOptionTargetType(regexpIndexPairTargetType());
    case "option-of-string":
      return rustOptionTargetType(rustStringTargetType());
    case "option-of-js-string":
      return rustOptionTargetType(rustJsStringTargetType());
    case "option-of-string-array":
      return rustOptionTargetType(rustJsArrayTargetType(rustStringTargetType()));
    case "option-of-js-string-array":
      return rustOptionTargetType(rustJsArrayTargetType(rustJsStringTargetType()));
    case "element-array":
      return bindings.element === undefined ? undefined : rustJsArrayTargetType(bindings.element);
    case "option-of-uint16":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("uint16"));
    case "option-of-uint32":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("uint32"));
    case "option-of-native-uint":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("native-uint"));
    case "option-of-float64":
      return rustOptionTargetType(rustSourcePrimitiveTargetType("float64"));
    case "float64":
      return rustSourcePrimitiveTargetType("float64");
    case "infer":
      return rustInferCarrier;
    case "selected-method-type-argument":
      return bindings.selectedMethodTypeArguments?.[reference.index];
    case "selected-method-input-array": {
      const element = bindings.selectedMethodTypeArguments?.[reference.index];
      return element === undefined ? undefined : rustVecTargetType(element);
    }
    case "selected-method-output-array": {
      const element = bindings.selectedMethodTypeArguments?.[reference.index];
      return element === undefined ? undefined : rustJsArrayTargetType(element);
    }
    case "bool":
      return rustSourcePrimitiveTargetType("bool");
    case "intl-grouping":
      return { kind: "target-named", id: rustJsIntlGroupingTargetId };
    case "bigint":
      return rustBigIntTargetType();
    case "empty-object":
      return rustEmptyObjectTargetType();
    case "js-numeric":
      return rustJsNumericTargetType();
    case "unit":
      return rustUnitTargetType();
    case "string":
      return rustStringTargetType();
    case "js-string":
      return rustJsStringTargetType();
    case "undefined":
      return rustAbsenceTargetType();
    case "element":
      return bindings.element;
    case "option-of-element":
      return bindings.element === undefined ? undefined : rustOptionTargetType(bindings.element);
    case "array-entries":
      return bindings.element === undefined ? undefined : rustJsArrayEntriesTargetType(bindings.element);
    case "uint8-array":
      return rustJsTypedArrayTargetType("Uint8Array");
    case "typed-array":
      return rustJsTypedArrayTargetType(reference.name);
    case "array-entry-result":
      return bindings.element === undefined ? undefined : rustIteratorResultTargetType({
        yieldType: rustJsArrayEntryTargetType(bindings.element),
        returnType: rustAbsenceTargetType(),
      });
    case "receiver":
      return bindings.receiver;
    case "map-key":
      return bindings.mapKey;
    case "map-value":
      return bindings.mapValue;
    case "option-of-map-value":
      return bindings.mapValue === undefined ? undefined : rustOptionTargetType(bindings.mapValue);
    case "map-key-array":
      return bindings.mapKey === undefined ? undefined : rustVecTargetType(bindings.mapKey);
    case "map-value-array":
      return bindings.mapValue === undefined ? undefined : rustVecTargetType(bindings.mapValue);
    case "map-entry-array":
      return bindings.mapKey === undefined || bindings.mapValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.mapKey, bindings.mapValue] });
    case "js-map-entry-array":
      return bindings.mapKey === undefined || bindings.mapValue === undefined
        ? undefined
        : rustJsArrayTargetType({
            kind: "tuple",
            elements: [bindings.mapKey, bindings.mapValue],
          });
    case "set-value":
      return bindings.setValue;
    case "set-value-array":
      return bindings.setValue === undefined ? undefined : rustVecTargetType(bindings.setValue);
    case "set-entry-array":
      return bindings.setValue === undefined
        ? undefined
        : rustVecTargetType({ kind: "tuple", elements: [bindings.setValue, bindings.setValue] });
    case "symbol":
      return rustJsSymbolTargetType();
    case "weak-key":
      return bindings.weakKey;
    case "weak-value":
      return bindings.weakValue;
    case "option-of-weak-value":
      return bindings.weakValue === undefined
        ? undefined
        : rustOptionTargetType(bindings.weakValue);
    case "weak-map-entry-array":
      return bindings.weakKey === undefined || bindings.weakValue === undefined
        ? undefined
        : rustJsArrayTargetType({
            kind: "tuple",
            elements: [bindings.weakKey, bindings.weakValue],
          });
    case "weak-key-array":
      return bindings.weakKey === undefined
        ? undefined
        : rustJsArrayTargetType(bindings.weakKey);
    case "array-buffer":
      return rustJsArrayBufferTargetType();
    case "int32-array":
      return rustJsTypedArrayTargetType("Int32Array");
    case "date":
      return { kind: "target-named", id: rustJsDateTargetId };
    case "future-output":
      return rustFutureOutputCarrier(bindings.sourceResult);
    case "promise-output":
      return bindings.promiseOutput;
    case "promise-input-output":
      return bindings.promiseInputOutput;
    case "promise-of-input-output":
      return bindings.promiseInputOutput === undefined
        ? undefined
        : rustJsPromiseTargetType(bindings.promiseInputOutput);
    case "promise-of-settled-input-output-array":
      return bindings.promiseInputOutput === undefined
        ? undefined
        : rustJsPromiseTargetType(rustJsArrayTargetType(
            rustJsPromiseSettledResultTargetType(bindings.promiseInputOutput),
          ));
    case "promise-finally-callback":
      return rustCallableTargetType([], rustUnitTargetType());
    case "json-replacer-callback":
      return rustClosureTargetType(
        [rustStringTargetType(), rustJsValueTargetType()],
        rustJsValueTargetType(),
      );
    case "null":
      return rustAbsenceTargetType();
    case "source-result":
      return bindings.sourceResult;
    case "argument":
      return bindings.arguments?.[reference.index];
    case "numeric-argument": {
      const carrier = bindings.arguments?.[reference.index];
      return isRustNumericCarrier(carrier) ? carrier : undefined;
    }
    case "numeric-array-argument": {
      const carrier = bindings.arguments?.[reference.index];
      const element = carrier !== undefined && isRustJsArrayCarrier(carrier)
        ? rustJsArrayLikeElementTargetType(carrier) : undefined;
      return isRustNumericCarrier(element) ? carrier : undefined;
    }
  }
}

function regexpIndexPairTargetType(): TargetTypeRef {
  return {
    kind: "tuple",
    elements: [
      rustSourcePrimitiveTargetType("native-uint"),
      rustSourcePrimitiveTargetType("native-uint"),
    ],
  };
}

function arrayCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3,
  result: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [bindings.element, rustSourcePrimitiveTargetType("native-uint"), bindings.receiver].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], result);
}

function arrayReduceCallbackCarrier(
  bindings: JsLaneBindings,
  arity: 0 | 1 | 2 | 3 | 4,
  accumulator: TargetTypeRef,
): TargetTypeRef | undefined {
  const args = [
    accumulator,
    bindings.element,
    rustSourcePrimitiveTargetType("native-uint"),
    bindings.receiver,
  ].slice(0, arity);
  return args.some((argument) => argument === undefined)
    ? undefined
    : rustClosureTargetType(args as TargetTypeRef[], accumulator);
}
