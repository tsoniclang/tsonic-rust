import type { RustNativeNodeId, RustNativeSourceSpan } from "./evidence.js";
import type { RustNativeBodyFlow, RustNativeFlowAccess, RustNativeFlowOrigin, RustNativeFlowProjection,
  RustNativeFlowStep } from "./flow-model.js";
import type { NativeTypeDecodeContext } from "./decode-type-context.js";
import { createNativeFlowControlDecoder } from "./decode-flow-control.js";
import { array, boolean, choice, index, record, shape, unsignedDecimal } from "./decode-values.js";

export function createNativeFlowDecoder(
  context: NativeTypeDecodeContext,
  readers: {
    readonly node: (value: unknown) => RustNativeNodeId;
    readonly span: (value: unknown) => RustNativeSourceSpan | null;
  },
): (value: unknown) => RustNativeBodyFlow {
  const origin = (value: unknown): RustNativeFlowOrigin => {
    context.reserve();
    const input = shape(value, ["node", "source"]);
    return Object.freeze({ node: readers.node(input.node), source: readers.span(input.source) });
  };
  const projection = (value: unknown): RustNativeFlowProjection => {
    context.reserve();
    const input = record(value);
    const kind = choice(input.kind, ["dereference", "field", "index", "constant-index", "subslice", "downcast",
      "opaque-cast", "unwrap-unsafe-binder"]);
    switch (kind) {
      case "dereference":
      case "opaque-cast":
      case "unwrap-unsafe-binder":
        shape(input, ["kind"]);
        return Object.freeze({ kind });
      case "field":
        shape(input, ["kind", "field"]);
        return Object.freeze({ kind, field: index(input.field) });
      case "index":
        shape(input, ["kind", "local"]);
        return Object.freeze({ kind, local: index(input.local) });
      case "constant-index": {
        shape(input, ["kind", "offset", "minimumLength", "fromEnd"]);
        const offset = unsignedDecimal(input.offset, 64);
        const minimumLength = unsignedDecimal(input.minimumLength, 64);
        const fromEnd = boolean(input.fromEnd);
        if (fromEnd ? BigInt(offset) === 0n || BigInt(offset) > BigInt(minimumLength) : BigInt(offset) >= BigInt(minimumLength)) {
          throw new Error("Native Rust flow has an inconsistent constant index.");
        }
        return Object.freeze({ kind, offset, minimumLength, fromEnd });
      }
      case "subslice": {
        shape(input, ["kind", "from", "to", "fromEnd"]);
        const from = unsignedDecimal(input.from, 64);
        const to = unsignedDecimal(input.to, 64);
        const fromEnd = boolean(input.fromEnd);
        if (!fromEnd && BigInt(from) > BigInt(to)) throw new Error("Native Rust flow has a reversed subslice.");
        return Object.freeze({ kind, from, to, fromEnd });
      }
      case "downcast":
        shape(input, ["kind", "variant"]);
        return Object.freeze({ kind, variant: index(input.variant) });
    }
  };
  const access = (value: unknown): RustNativeFlowAccess => {
    context.reserve();
    const input = shape(value, ["kind", "local", "projections"]);
    const kind = choice(input.kind, ["inspect", "copy", "move", "borrow-shared", "borrow-fake", "address-shared",
      "place-mention", "projection-read", "store", "set-discriminant", "assembly-output", "call-result", "yield-result",
      "drop", "borrow-mutable", "address-mutable", "projection-write", "retag", "storage-live", "storage-dead",
      "ascribe-type", "debug-info", "drop-hint"]);
    return Object.freeze({ kind, local: index(input.local), projections: array(input.projections, projection) });
  };
  const step = (input: Readonly<Record<string, unknown>>): RustNativeFlowStep => {
    context.reserve();
    return Object.freeze({ origin: origin(input.origin), accesses: array(input.accesses, access) });
  };
  const control = createNativeFlowControlDecoder(context.reserve);
  return (value: unknown): RustNativeBodyFlow => {
    context.reserve();
    const input = shape(value, ["owner", "argumentCount", "locals", "blocks"]);
    return Object.freeze({ owner: context.definition(input.owner), argumentCount: index(input.argumentCount),
      locals: array(input.locals, value => {
        context.reserve();
        const local = shape(value, ["origin", "binding", "guardTarget"]);
        return Object.freeze({ origin: origin(local.origin), binding: local.binding === null ? null : readers.node(local.binding),
          guardTarget: local.guardTarget === null ? null : index(local.guardTarget) });
      }),
      blocks: array(input.blocks, value => {
        context.reserve();
        const block = shape(value, ["cleanup", "statements", "terminator"]);
        const terminator = shape(block.terminator, ["origin", "accesses", "control"]);
        return Object.freeze({ cleanup: boolean(block.cleanup),
          statements: array(block.statements, value => step(shape(value, ["origin", "accesses"]))),
          terminator: Object.freeze({ ...step(terminator), control: control(terminator.control) }) });
      }),
    });
  };
}
