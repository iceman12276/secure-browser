export type FormKind = 'login' | 'signup';

export interface DetectedForm {
  formIndex: number;
  usernameSelector: string | null;
  passwordSelector: string;
  kind: FormKind;
}

/** content → main: forms found on the current page. */
export interface DetectedForms {
  origin: string;
  forms: DetectedForm[];
}

/** content → main (invoke): user clicked a candidate. */
export interface FillRequest {
  credentialId: string;
}

/** main → content (invoke result): the single released secret. */
export interface FillResult {
  username: string;
  secret: string;
}

/** content → main (invoke): a form was submitted. */
export interface CaptureRequest {
  origin: string;
  username: string;
  secret: string;
}

/** main → chrome: offer to save a new/changed credential. */
export interface SavePrompt {
  origin: string;
  username: string;
  secret: string;
}

/** main → content: origin-matched candidate metadata (NO secret). */
export interface Candidate {
  id: string;
  username: string;
  label: string;
}
