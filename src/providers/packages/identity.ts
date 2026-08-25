export function rustProviderBindingProviderId(packageId: string): string {
  return `tsonic.rust.provider-package.${packageId}.binding`;
}
