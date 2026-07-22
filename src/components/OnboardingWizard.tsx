import { useEffect, useState } from "react";
import { APP_RELEASE_LABEL, APP_TAGLINE } from "../lib/appMeta";

const STORAGE_KEY = "horizon:onboarding-v1-done";

const STEPS = [
  {
    title: "Welcome to Horizon",
    body: (
      <>
        <p>
          Horizon projects a <strong>two-person Ontario household</strong> through work and
          retirement — federal + Ontario tax, RRSP/RRIF/LIF, TFSA, CPP/OAS, and market stress tests.
        </p>
        <p className="hint">
          {APP_RELEASE_LABEL} · {APP_TAGLINE}. Everything runs in your browser.
        </p>
      </>
    ),
  },
  {
    title: "How to use it",
    body: (
      <>
        <ol className="onboard-list">
          <li>
            A <strong>sample couple</strong> is pre-loaded and analyzed so you see results immediately.
          </li>
          <li>
            Edit <strong>Lifestyle</strong>, each spouse, and <strong>Tax strategy</strong> in the left
            panel.
          </li>
          <li>
            Press <strong>Run full plan</strong> after changes — that re-searches the tax-aware
            meltdown strategy vs a naive baseline.
          </li>
          <li>
            Optionally run a <strong>Market stress test</strong> (Monte Carlo) and explore longevity
            scenarios.
          </li>
        </ol>
      </>
    ),
  },
  {
    title: "Privacy & limits",
    body: (
      <>
        <p>
          Plans stay on <strong>this device</strong> (local storage). Nothing is sent to a Horizon
          server.
        </p>
        <p>
          Outputs are <strong>planning estimates</strong>, not financial, tax, or legal advice. Tax
          rules are simplified (see the disclaimer and design docs).
        </p>
      </>
    ),
  },
] as const;

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function OnboardingWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const last = step >= STEPS.length - 1;
  const s = STEPS[step];

  const finish = () => {
    markOnboardingDone();
    onClose();
  };

  return (
    <div className="onboard-backdrop" data-testid="onboarding-wizard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-card">
        <div className="onboard-progress" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`onboard-dot${i === step ? " active" : i < step ? " done" : ""}`} />
          ))}
        </div>
        <p className="onboard-step-label">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 id="onboard-title">{s.title}</h2>
        <div className="onboard-body">{s.body}</div>
        <div className="onboard-actions">
          <button type="button" className="btn btn-ghost" onClick={finish} data-testid="onboard-skip">
            Skip
          </button>
          <div className="onboard-actions-right">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep((x) => x - 1)}>
                Back
              </button>
            )}
            {!last ? (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="onboard-next"
                onClick={() => setStep((x) => x + 1)}
              >
                Next
              </button>
            ) : (
              <button type="button" className="btn btn-primary" data-testid="onboard-done" onClick={finish}>
                Start planning
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
