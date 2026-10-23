"use client";

// The per-property keyframe diamond. Grey outline: not animated (click to start).
// Accent outline: animated, no key at the playhead (click to add one).
// Filled: key at the playhead (click to remove it).
export type KeyState = "none" | "anim" | "key";

const TITLES: Record<KeyState, string> = {
  none: "Animate: key this at the playhead",
  anim: "Add a key at the playhead",
  key: "Remove this key",
};

export default function KeyButton({ state, onClick, label }: { state: KeyState; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`kf kf-${state}`} onClick={onClick} title={TITLES[state]} aria-label={`${TITLES[state]} (${label})`}>
      {state === "key" ? "◆" : "◇"}
    </button>
  );
}
