/** Shared progress events for long engine runs (UI + worker). */

export interface ProgressEvent {
  /** Coarse stage id for UI mapping. */
  phase: string;
  /** 0..1 when known. */
  fraction?: number;
  /** Human-readable status line. */
  detail?: string;
}

export type ProgressCallback = (p: ProgressEvent) => void;
