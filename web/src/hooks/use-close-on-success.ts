import { useState } from "react";

// Closes a dialog once a useActionState result turns from "no result yet" (or
// an error) into a fresh success. Adjusting state directly in the render body
// like this — guarded by a comparison against the previous render's value —
// is React's own sanctioned alternative to a useEffect that only exists to
// mirror one piece of state into another; see "You Might Not Need an Effect".
export function useCloseOnSuccess<T extends { error?: unknown } | undefined>(
  state: T,
  setOpen: (open: boolean) => void
) {
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state && !state.error) setOpen(false);
  }
}
