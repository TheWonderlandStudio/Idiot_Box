import { useEffect, useRef } from "react";

let activeDialog = null;

export default function useDialogFocus(open, dialogRef, initialFocusRef, onDismiss, restoreFocusRef) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!open) return;
    const previous = activeDialog?.previous || document.activeElement;
    if (activeDialog) {
      activeDialog.restoreFocusRef.current = false;
      activeDialog.dismiss();
    }
    const session = { previous, restoreFocusRef, dismiss: () => dismissRef.current() };
    activeDialog = session;
    initialFocusRef.current?.focus();
    const onKey = (event) => {
      if (activeDialog !== session) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
      } else if (event.key === "Tab") {
        const elements = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') || [])]
          .filter((element) => element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (!first) return;
        if (!dialogRef.current.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault(); first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (activeDialog === session) {
        activeDialog = null;
        if (restoreFocusRef.current && previous?.isConnected) previous.focus({ preventScroll: true });
      }
    };
  }, [open]);
}
