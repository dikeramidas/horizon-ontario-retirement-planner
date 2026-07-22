import { useState } from "react";
import type { HouseholdInput } from "../simulate";
import {
  buildRunFingerprint,
  fingerprintDigest,
  parseFingerprint,
  serializeFingerprint,
} from "../lib/runFingerprint";

export function RunFingerprintPanel({
  inputs,
  seed,
  mcTrials,
  defaultVol,
  onRestore,
}: {
  inputs: HouseholdInput;
  seed: number;
  mcTrials: number;
  defaultVol: number;
  onRestore: (next: {
    inputs: HouseholdInput;
    seed: number;
    mcTrials: number;
    defaultVol: number;
  }) => void;
}) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const fp = buildRunFingerprint({ inputs, seed, mcTrials, defaultVol });
  const digest = fingerprintDigest(fp);
  const json = serializeFingerprint(fp);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setMsg(`Copied fingerprint ${digest}`);
    } catch {
      setMsg("Clipboard unavailable — select the box and copy manually.");
    }
  };

  const restore = () => {
    const parsed = parseFingerprint(paste.trim());
    if (!parsed) {
      setMsg("Could not parse fingerprint JSON.");
      return;
    }
    onRestore({
      inputs: parsed.inputs,
      seed: parsed.seed,
      mcTrials: parsed.mcTrials,
      defaultVol: parsed.defaultVol,
    });
    setMsg(`Restored fingerprint ${fingerprintDigest(parsed)} — run full plan to refresh results.`);
  };

  return (
    <div className="fingerprint-panel" data-testid="run-fingerprint">
      <h3 style={{ margin: "0 0 0.35rem", fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "1.2rem" }}>
        Run fingerprint
      </h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Snapshot of inputs + seed / MC settings for support or exact restore. Digest{" "}
        <code data-testid="fp-digest">{digest}</code>.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button type="button" className="btn btn-primary" data-testid="fp-copy" onClick={() => void copy()}>
          Copy JSON
        </button>
      </div>
      <textarea
        className="fp-textarea"
        readOnly
        value={json}
        rows={4}
        data-testid="fp-json"
        aria-label="Fingerprint JSON"
      />
      <p className="hint">Paste a fingerprint below to restore inputs (does not auto-run analysis).</p>
      <textarea
        className="fp-textarea"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={3}
        placeholder='{"v":1,"app":"horizon",...}'
        data-testid="fp-paste"
        aria-label="Paste fingerprint JSON"
      />
      <button type="button" className="btn" data-testid="fp-restore" onClick={restore}>
        Restore from paste
      </button>
      {msg && (
        <p className="hint" data-testid="fp-msg">
          {msg}
        </p>
      )}
    </div>
  );
}
