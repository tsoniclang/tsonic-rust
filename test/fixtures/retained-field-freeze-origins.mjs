export const retainedFieldFreezeOrigins = [
  { name: "nominal-alias", declarations:
    "function freeze(value: Value): void { const alias = value; Object.freeze(alias); }", invocation: "freeze(value);" },
  { name: "structural-chain", declarations: `
function freeze(value: { value: number }): void { Object.freeze(value); }
function relay(value: { value: number; label: string }): void { freeze(value); }
`, invocation: "relay(value);" },
  { name: "interface", declarations:
    "interface View { value: number; } function freeze(value: View): void { Object.freeze(value); }", invocation: "freeze(value);" },
  { name: "narrowed-union", declarations: `
class Other { other = 1; }
function freeze(value: Value | Other): void {
  if (value instanceof Value) Object.freeze(value);
  else Object.freeze(value);
}
`, invocation: "freeze(value);" },
];

export const retainedFieldFreezeValueSource = `
class Value {
  value = 1;
  label = "value";
  read = (): number => this.value;
  change = (): void => { this.value = 2; };
}
`;
