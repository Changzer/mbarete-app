/** Shared by the dossier UI, request reader and file store. Values use MiB. */
export const DOSSIER_DOCUMENT_MAX_MB = 100;
export const DOSSIER_DOCUMENT_MAX_BYTES = DOSSIER_DOCUMENT_MAX_MB * 1024 * 1024;
// The multipart envelope and small metadata fields also count towards the body.
export const DOSSIER_DOCUMENT_BODY_BYTES = DOSSIER_DOCUMENT_MAX_BYTES + 2 * 1024 * 1024;
