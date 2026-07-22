import { GLOSSARY, type GlossaryKey } from "../lib/glossary";

/** Inline “?” that shows a glossary definition (A10). */
export function GlossaryTip({
  term,
  children,
}: {
  term: GlossaryKey;
  /** Optional custom visible label; defaults to glossary term. */
  children?: React.ReactNode;
}) {
  const e = GLOSSARY[term];
  const title = e.detail ? `${e.short}\n\n${e.detail}` : e.short;
  return (
    <span className="glossary-tip" data-testid={`glossary-${term}`}>
      {children ?? e.term}
      <button type="button" className="glossary-q" title={title} aria-label={`About ${e.term}`}>
        ?
      </button>
    </span>
  );
}
