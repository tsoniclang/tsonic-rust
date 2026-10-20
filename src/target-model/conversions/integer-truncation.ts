export interface RustIntegerTruncationConversion {
  readonly kind: "integer-truncation";
  readonly width: number;
  readonly signed: boolean;
}
