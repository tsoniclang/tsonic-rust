// Structured Rust output model for the static-native construct set. The
// printer is the only place this model becomes text.

import type {
  RustAssignmentOperator,
  RustBinaryOperator,
  RustPrimitiveTypeName,
} from "../../target-model/syntax/tokens.js";
import type { RustAbi } from "../../target-model/semantics/index.js";
import type { RustAttribute, RustScopedAttribute } from "./attributes.js";

export type RustLifetime =
  | { readonly kind: "static" }
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "inferred" };

export type RustConstExpression =
  | { readonly kind: "integer"; readonly value: bigint }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "character"; readonly value: string }
  | { readonly kind: "path"; readonly path: string; readonly genericArguments?: readonly RustGenericArgument[] }
  | { readonly kind: "inferred" }
  | {
      readonly kind: "unary";
      readonly operator: "-" | "!";
      readonly operand: RustConstExpression;
    }
  | {
      readonly kind: "binary";
      readonly operator: "+" | "-" | "*" | "/" | "%" | "<<" | ">>" | "&" | "|" | "^";
      readonly left: RustConstExpression;
      readonly right: RustConstExpression;
    };

export type RustGenericArgument =
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetime }
  | { readonly kind: "type"; readonly type: RustType }
  | { readonly kind: "const"; readonly expression: RustConstExpression }
  | {
      readonly kind: "associated-equality";
      readonly name: string;
      readonly genericArguments?: readonly RustGenericArgument[];
      readonly type: RustType;
    }
  | {
      readonly kind: "associated-bounds";
      readonly name: string;
      readonly genericArguments?: readonly RustGenericArgument[];
      readonly bounds: readonly RustTypeBound[];
    };

export type RustTypeBound =
  | {
      readonly kind: "trait";
      readonly trait: RustType;
      readonly polarity?: "required" | "maybe";
      readonly binder?: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
    }
  | { readonly kind: "lifetime"; readonly lifetime: RustLifetime }
  | {
      readonly kind: "callable-trait";
      readonly trait: "Fn" | "FnMut" | "FnOnce";
      readonly binder?: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
      readonly parameters: readonly RustType[];
      readonly result: RustType;
    }
  | { readonly kind: "precise-capture"; readonly captures: readonly RustGenericArgument[] };

export type RustGenericParameter =
  | {
      readonly kind: "lifetime";
      readonly name: string;
      readonly bounds: readonly RustLifetime[];
    }
  | {
      readonly kind: "type";
      readonly name: string;
      readonly bounds: readonly RustTypeBound[];
      readonly defaultType?: RustType;
    }
  | {
      readonly kind: "const";
      readonly name: string;
      readonly type: RustType;
      readonly defaultValue?: RustConstExpression;
    };

export type RustWherePredicate =
  | {
      readonly kind: "lifetime";
      readonly lifetime: RustLifetime;
      readonly outlives: readonly RustLifetime[];
    }
  | {
      readonly kind: "type";
      readonly type: RustType;
      readonly bounds: readonly RustTypeBound[];
      readonly binder?: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
    };

export interface RustGenerics {
  readonly parameters: readonly RustGenericParameter[];
  readonly wherePredicates: readonly RustWherePredicate[];
}

export const emptyRustAstGenerics: RustGenerics = Object.freeze({
  parameters: Object.freeze([]),
  wherePredicates: Object.freeze([]),
});

export type RustType =
  | { readonly kind: "infer" }
  | { readonly kind: "primitive"; readonly name: RustPrimitiveTypeName }
  | { readonly kind: "string" }
  | { readonly kind: "str" }
  | { readonly kind: "unit" }
  | { readonly kind: "never" }
  | { readonly kind: "named"; readonly path: string; readonly identity?: string; readonly genericArguments?: readonly RustGenericArgument[] }
  | {
      readonly kind: "qualified";
      readonly owner: RustType;
      readonly trait?: RustType;
      readonly member: string;
      readonly genericArguments?: readonly RustGenericArgument[];
    }
  | { readonly kind: "trait-object"; readonly bounds: readonly RustTypeBound[]; readonly lifetime?: RustLifetime }
  | { readonly kind: "opaque"; readonly bounds: readonly RustTypeBound[] }
  | { readonly kind: "reference"; readonly referent: RustType; readonly mutable: boolean; readonly lifetime?: RustLifetime }
  | { readonly kind: "raw-pointer"; readonly pointee: RustType; readonly mutable: boolean }
  | { readonly kind: "fixed-array"; readonly element: RustType; readonly length: RustConstExpression }
  | { readonly kind: "slice"; readonly element: RustType }
  | {
      readonly kind: "function-pointer";
      readonly binder?: readonly Extract<RustGenericParameter, { readonly kind: "lifetime" }>[];
      readonly parameters: readonly RustType[];
      readonly result: RustType;
      readonly abi?: RustAbi;
      readonly isUnsafe?: boolean;
      readonly variadic?: boolean;
    }
  | { readonly kind: "tuple"; readonly elements: readonly RustType[] };

export type RustPattern =
  | { readonly kind: "wildcard" }
  | {
      readonly kind: "binding";
      readonly name: string;
      readonly mutable?: boolean;
      readonly mode?: "value" | "ref" | "ref-mut";
      readonly subpattern?: RustPattern;
    }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "tuple"; readonly elements: readonly RustPattern[] }
  | {
      readonly kind: "tuple-variant";
      readonly path: string;
      readonly elements: readonly RustPattern[];
    }
  | {
      readonly kind: "struct";
      readonly path: string;
      readonly fields: readonly { readonly name: string; readonly pattern: RustPattern }[];
      readonly rest: boolean;
    }
  | { readonly kind: "slice"; readonly prefix: readonly RustPattern[]; readonly rest?: RustPattern; readonly suffix: readonly RustPattern[] }
  | { readonly kind: "reference"; readonly mutable: boolean; readonly pattern: RustPattern }
  | { readonly kind: "or"; readonly patterns: readonly RustPattern[] }
  | { readonly kind: "literal"; readonly expression: RustExpr };

export type RustExpr =
  | { readonly kind: "int-literal"; readonly text: string }
  | { readonly kind: "float-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "char-literal"; readonly value: string }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "str-literal"; readonly value: string }
  | { readonly kind: "owned-string-from-borrowed-str"; readonly expression: RustExpr }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "bottom"; readonly expression: RustExpr }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: RustExpr }
  | { readonly kind: "dereference"; readonly pointer: RustExpr }
  | { readonly kind: "numeric-cast"; readonly expression: RustExpr; readonly target: RustPrimitiveTypeName }
  | { readonly kind: "binary"; readonly operator: RustBinaryOperator; readonly left: RustExpr; readonly right: RustExpr }
  | { readonly kind: "range"; readonly start: RustExpr; readonly end: RustExpr; readonly inclusive?: boolean }
  | { readonly kind: "conditional"; readonly condition: RustExpr; readonly whenTrue: RustExpr; readonly whenFalse: RustExpr }
  | {
      readonly kind: "match";
      readonly expression: RustExpr;
      readonly arms: readonly {
        readonly pattern: RustPattern;
        readonly expression: RustExpr;
      }[];
    }
  | { readonly kind: "matches"; readonly expression: RustExpr; readonly pattern: RustPattern }
  | { readonly kind: "assignment"; readonly operator: RustAssignmentOperator; readonly target: RustExpr; readonly value: RustExpr }
  | { readonly kind: "call"; readonly path: string; readonly genericArguments?: readonly RustGenericArgument[]; readonly args: readonly RustExpr[] }
  | { readonly kind: "invoke"; readonly callee: RustExpr; readonly args: readonly RustExpr[] }
  | { readonly kind: "associated-value"; readonly owner: RustType; readonly trait?: RustType; readonly name: string }
  | { readonly kind: "associated-call"; readonly owner: RustType; readonly trait?: RustType; readonly method: string; readonly genericArguments?: readonly RustGenericArgument[]; readonly args: readonly RustExpr[] }
  | {
      readonly kind: "method-call";
      readonly receiver: RustExpr;
      readonly method: string;
      readonly genericArguments?: readonly RustGenericArgument[];
      readonly args: readonly RustExpr[];
      readonly receiverMode?: "value" | "ref" | "mut-ref";
    }
  | { readonly kind: "field"; readonly receiver: RustExpr; readonly name: string }
  | { readonly kind: "tuple-field"; readonly receiver: RustExpr; readonly index: number }
  | { readonly kind: "index"; readonly receiver: RustExpr; readonly index: RustExpr }
  | {
      readonly kind: "block";
      readonly innerAttrs?: readonly RustAttribute[];
      readonly bindings: readonly {
        readonly name: string;
        readonly value: RustExpr;
        readonly type?: RustType;
        readonly mutable?: boolean;
        readonly attrs?: readonly RustAttribute[];
      }[];
      readonly value: RustExpr;
    }
  | { readonly kind: "unsafe"; readonly expression: RustExpr }
  | { readonly kind: "evaluate-then"; readonly effect: RustExpr; readonly discard: "unit" | "value"; readonly value: RustExpr }
  | { readonly kind: "string-concat"; readonly parts: readonly RustExpr[] }
  | {
      readonly kind: "format-write";
      readonly writer: RustExpr;
      readonly format: string;
      readonly args: readonly RustExpr[];
    }
  | { readonly kind: "reference"; readonly expr: RustExpr; readonly mutable?: boolean }
  | { readonly kind: "vec-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "slice-literal"; readonly elements: readonly RustExpr[] }
  | { readonly kind: "closure"; readonly params: readonly { readonly name: string; readonly byRefCopy: boolean }[]; readonly move?: boolean; readonly body: RustExpr }
  | {
      readonly kind: "closure-block";
      readonly params: readonly { readonly name: string; readonly mutable: boolean; readonly byRefCopy?: boolean }[];
      readonly move: boolean;
      readonly async: boolean;
      readonly body: RustBlock;
    }
  | { readonly kind: "await"; readonly expr: RustExpr }
  | {
      readonly kind: "try";
      readonly expr: RustExpr;
      readonly resultErrorType: RustType;
      readonly operandErrorType: RustType;
    }
  | { readonly kind: "return-expression"; readonly expr?: RustExpr }
  | { readonly kind: "unreachable"; readonly message: string }
  | {
      readonly kind: "struct-literal";
      readonly path: string;
      readonly genericArguments?: readonly RustGenericArgument[];
      readonly fields: readonly { readonly name: string; readonly value: RustExpr }[];
      readonly base?: RustExpr;
    }
  | { readonly kind: "tuple-literal"; readonly elements: readonly RustExpr[] };

export type {
  RustErrorDomain,
} from "../../target-model/operations/error-boundary.js";

export type RustStmt =
  | { readonly kind: "let"; readonly name: string; readonly mutable: boolean; readonly type?: RustType; readonly init?: RustExpr; readonly attrs?: readonly RustAttribute[] }
  | { readonly kind: "let-pattern"; readonly pattern: RustPattern; readonly init: RustExpr }
  | { readonly kind: "expr"; readonly expr: RustExpr }
  | { readonly kind: "assign"; readonly target: RustExpr; readonly operator: RustAssignmentOperator; readonly value: RustExpr }
  | { readonly kind: "return"; readonly expr?: RustExpr }
  | { readonly kind: "tail"; readonly expr: RustExpr }
  | { readonly kind: "if"; readonly condition: RustExpr; readonly then: RustBlock; readonly else?: RustBlock; readonly elseIf?: true; readonly attrs?: readonly RustAttribute[] }
  | { readonly kind: "loop"; readonly label?: string; readonly body: RustBlock; readonly neverFallsThrough?: boolean }
  | { readonly kind: "while"; readonly label?: string; readonly condition: RustExpr; readonly body: RustBlock; readonly attrs?: readonly RustAttribute[] }
  | { readonly kind: "while-let-some"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly expression: RustExpr; readonly body: RustBlock }
  | { readonly kind: "for"; readonly label?: string; readonly binding: string; readonly bindingMutable?: boolean; readonly iterable: RustExpr; readonly body: RustBlock; readonly attrs?: readonly RustAttribute[] }
  | { readonly kind: "if-let-some"; readonly binding: string; readonly expression: RustExpr; readonly body: RustBlock }
  | { readonly kind: "break"; readonly label?: string }
  | { readonly kind: "continue"; readonly label?: string }
  | {
      readonly kind: "completion-exit";
      readonly completion: "return" | "break" | "continue";
      readonly resultWrapped: boolean;
      readonly tail?: true;
      readonly expr?: RustExpr;
      readonly loopId?: number;
    }
  | {
      readonly kind: "resource-scope";
      readonly flowName: string;
      readonly cleanupName: string;
      readonly returnType: RustType;
      readonly fallible: boolean;
      readonly asynchronous: boolean;
      readonly body: RustBlock;
      readonly cleanup: RustBlock;
      readonly tail?: true;
      readonly propagate: boolean;
      readonly dispatchReturn: boolean;
      readonly dispatchTargets: readonly {
        readonly kind: "loop" | "switch" | "label";
        readonly id: number;
        readonly label: string;
        readonly continuePrelude?: readonly RustStmt[];
      }[];
      readonly terminates: boolean;
    }
  | { readonly kind: "index-assign"; readonly receiver: RustExpr; readonly index: RustExpr; readonly value: RustExpr }
  | { readonly kind: "scope"; readonly label?: string; readonly body: RustBlock }
  | { readonly kind: "unsafe-scope"; readonly body: RustBlock }
  | { readonly kind: "throw"; readonly error: RustExpr; readonly tail?: true }
  | {
      readonly kind: "try-scope";
      readonly bodyName: string;
      readonly flowName: string;
      readonly finallyName?: string;
      readonly returnType: RustType;
      readonly fallible: boolean;
      readonly asynchronous: boolean;
      readonly body: RustBlock;
      readonly bodyFallible: boolean;
      readonly bodyTerminates: boolean;
      readonly tail?: true;
      readonly catchClause?: {
        readonly binding: string;
        readonly body: RustBlock;
        readonly fallible: boolean;
        readonly terminates: boolean;
      };
      readonly finallyClause?: {
        readonly body: RustBlock;
        readonly fallible: boolean;
        readonly terminates: boolean;
      };
      readonly propagate: boolean;
      readonly dispatchReturn: boolean;
      readonly dispatchTargets: readonly {
        readonly kind: "loop" | "switch" | "label";
        readonly id: number;
        readonly label: string;
        readonly continuePrelude?: readonly RustStmt[];
      }[];
      readonly terminates: boolean;
    };

export interface RustBlock {
  readonly innerAttrs?: readonly RustAttribute[];
  readonly statements: readonly RustStmt[];
}

export interface RustFunctionParam {
  readonly name: string;
  readonly type: RustType;
  readonly mutable?: boolean;
}

export type RustReceiver =
  | { readonly kind: "value"; readonly mutable?: boolean }
  | { readonly kind: "reference"; readonly mutable: boolean; readonly lifetime?: RustLifetime }
  | { readonly kind: "typed"; readonly type: RustType; readonly mutable?: boolean };

export type RustVisibility = "private" | "crate" | "public";

export interface RustStructField {
  readonly name: string;
  readonly type: RustType;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly RustAttribute[];
}

export type RustStructFields =
  | { readonly kind: "unit" }
  | { readonly kind: "tuple"; readonly fields: readonly Omit<RustStructField, "name">[] }
  | { readonly kind: "named"; readonly fields: readonly RustStructField[] };

export interface RustImplFunction {
  readonly name: string;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly RustAttribute[];
  readonly isAsync?: boolean;
  readonly isUnsafe?: boolean;
  readonly abi?: RustAbi;
  readonly variadic?: boolean;
  readonly errorType?: RustType;
  readonly generics: RustGenerics;
  readonly receiver?: RustReceiver;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly body: RustBlock;
}

export interface RustTraitFunction {
  readonly name: string;
  readonly attrs?: readonly RustAttribute[];
  readonly isAsync?: boolean;
  readonly isUnsafe?: boolean;
  readonly abi?: RustAbi;
  readonly variadic?: boolean;
  readonly errorType?: RustType;
  readonly generics: RustGenerics;
  readonly receiver?: RustReceiver;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly body?: RustBlock;
}

export interface RustExternFunction {
  readonly name: string;
  readonly visibility: RustVisibility;
  readonly attrs?: readonly RustAttribute[];
  readonly safety: "inherited" | "safe" | "unsafe";
  readonly generics: RustGenerics;
  readonly params: readonly RustFunctionParam[];
  readonly returnType?: RustType;
  readonly variadic?: boolean;
}

export interface RustAssociatedTypeItem {
  readonly kind: "associated-type";
  readonly name: string;
  readonly generics: RustGenerics;
  readonly bounds: readonly RustTypeBound[];
  readonly value?: RustType;
}

export interface RustAssociatedConstItem {
  readonly kind: "associated-const";
  readonly name: string;
  readonly type: RustType;
  readonly value?: RustExpr;
}

export type RustItem =
  | {
      readonly kind: "function";
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly attrs?: readonly RustAttribute[];
      readonly isAsync?: boolean;
      readonly isUnsafe?: boolean;
      readonly abi?: RustAbi;
      readonly variadic?: boolean;
      readonly errorType?: RustType;
      readonly generics: RustGenerics;
      readonly params: readonly RustFunctionParam[];
      readonly returnType?: RustType;
      readonly body: RustBlock;
    }
  | {
      readonly kind: "const";
      readonly attrs?: readonly RustAttribute[];
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly type: RustType;
      readonly value: RustExpr;
    }
  | {
      readonly kind: "static";
      readonly attrs?: readonly RustAttribute[];
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly type: RustType;
      readonly mutable: boolean;
      readonly value: RustExpr;
    }
  | {
      readonly kind: "thread-local";
      readonly attrs?: readonly RustAttribute[];
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly type: RustType;
      readonly value: RustExpr;
      readonly constInitializer: boolean;
    }
  | { readonly kind: "mod-decl"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly RustAttribute[] }
  | { readonly kind: "struct"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly RustAttribute[]; readonly generics: RustGenerics; readonly fields: RustStructFields }
  | {
      readonly kind: "trait";
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly attrs?: readonly RustAttribute[];
      readonly generics: RustGenerics;
      readonly safety: "safe" | "unsafe";
      readonly auto: boolean;
      readonly superTraits: readonly RustTypeBound[];
      readonly functions: readonly RustTraitFunction[];
      readonly associatedTypes: readonly RustAssociatedTypeItem[];
      readonly associatedConstants: readonly RustAssociatedConstItem[];
    }
  | {
      readonly kind: "impl";
      readonly attrs?: readonly RustAttribute[];
      readonly generics: RustGenerics;
      readonly trait?: RustType;
      readonly target: RustType;
      readonly polarity: "positive" | "negative";
      readonly safety: "safe" | "unsafe";
      readonly functions: readonly RustImplFunction[];
      readonly associatedTypes: readonly RustAssociatedTypeItem[];
      readonly associatedConstants: readonly RustAssociatedConstItem[];
    }
  | {
      readonly kind: "enum";
      readonly name: string;
      readonly visibility: RustVisibility;
      readonly attrs?: readonly RustAttribute[];
      readonly generics: RustGenerics;
      readonly variants: readonly {
        readonly name: string;
        readonly discriminant?: RustConstExpression;
        readonly fields: RustStructFields;
      }[];
    }
  | { readonly kind: "union"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly RustAttribute[]; readonly generics: RustGenerics; readonly fields: readonly RustStructField[] }
  | { readonly kind: "type-alias"; readonly name: string; readonly visibility: RustVisibility; readonly attrs?: readonly RustAttribute[]; readonly generics: RustGenerics; readonly target: RustType }
  | {
      readonly kind: "extern-block";
      readonly attrs?: readonly RustAttribute[];
      readonly abi: RustAbi;
      readonly safety: "safe" | "unsafe";
      readonly functions: readonly RustExternFunction[];
      readonly statics: readonly {
        readonly name: string;
        readonly visibility: RustVisibility;
        readonly type: RustType;
        readonly mutable: boolean;
        readonly safety: "inherited" | "safe" | "unsafe";
      }[];
    }
  | { readonly kind: "use"; readonly path: string; readonly alias?: string; readonly visibility?: RustVisibility };

export interface RustSourceFileModel {
  readonly headerComment: string;
  readonly attrs?: readonly RustScopedAttribute[];
  readonly items: readonly RustItem[];
}

export const rustGeneratedHeaderComment = "Generated by the Tsonic Rust target. Do not edit.";

export function createRustSourceFile(
  items: readonly RustItem[],
  attrs: readonly RustScopedAttribute[] = [],
): RustSourceFileModel {
  return {
    headerComment: rustGeneratedHeaderComment,
    ...(attrs.length === 0 ? {} : { attrs }),
    items,
  };
}
