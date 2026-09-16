"use client";

/**
 * SarahOverlay — hosts the audio setup wizard INSIDE the desktop operator shell
 * (2026-09-16 owner directive). "Run setup" used to navigate to /setup/audio, which
 * tore the operator out of the app and into a web page; now Sarah opens over the
 * console and closes back to exactly where they were.
 *
 * Opened by dispatching `presentflow:open-sarah`. Mounted once in ProOperatorShell,
 * so it costs nothing until it is opened (Radix renders no portal while closed).
 */
import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { SarahSetupWizard, type SarahLive } from "./SarahSetupWizard";

export const OPEN_SARAH_EVENT = "presentflow:open-sarah";

export function SarahOverlay({ live }: { live?: SarahLive } = {}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SARAH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SARAH_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm" />
        <Dialog.Content
          // The wizard owns its own layout, chrome and Close button.
          className="fixed inset-0 z-[91] overflow-y-auto focus:outline-none"
          onEscapeKeyDown={(e) => e.preventDefault()}   // leaving mid-check should be deliberate
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">Audio setup with Sarah</Dialog.Title>
          <Dialog.Description className="sr-only">
            Sarah walks you through connecting your church&apos;s sound to PresentFlow.
          </Dialog.Description>
          {open && <SarahSetupWizard onDone={close} live={live} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
