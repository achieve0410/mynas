export type CatalogErrorCode = "invalid_page" | "invalid_path" | "not_found";

export class CatalogError extends Error {
  public constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CatalogError";
  }
}
