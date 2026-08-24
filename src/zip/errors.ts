export class ZipError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipError';
  }
}

export class ZipFormatError extends ZipError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipFormatError';
  }
}

export class ZipEncryptedEntryError extends ZipError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipEncryptedEntryError';
  }
}

export class ZipUnsupportedMethodError extends ZipError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipUnsupportedMethodError';
  }
}

export class ZipEntryNotFoundError extends ZipError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipEntryNotFoundError';
  }
}
