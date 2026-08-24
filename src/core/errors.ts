/** Base class for every error this library throws. */
export class BookError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BookError';
  }
}

/** No registered format claimed the input bytes. */
export class UnrecognizedFormatError extends BookError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnrecognizedFormatError';
  }
}

/** The container structure is damaged or malformed. */
export class CorruptContainerError extends BookError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CorruptContainerError';
  }
}

/** The content is encrypted; DRM-free books only. */
export class EncryptedContentError extends BookError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EncryptedContentError';
  }
}
