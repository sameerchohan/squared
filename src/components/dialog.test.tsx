// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "./ui";

/**
 * This dialog has broken twice in production: once from a percentage-height
 * chain that could resolve to zero in an unusual rendering context, once
 * from centering an overflowing flex item with align-items, which clips
 * whichever end overflows first. Both bugs were invisible to a pure logic
 * test and to a build — they only show up when something actually renders
 * and is interacted with. These tests exist to make that class of bug
 * impossible to reintroduce without a red test.
 *
 * jsdom has no window.visualViewport at all, which is exactly the
 * "unreliable API" condition that caused the first bug — so every test here
 * already runs in that degraded environment by default, not as a special
 * case.
 */

function Harness({
  initialOpen = false,
  fieldCount = 2,
}: {
  initialOpen?: boolean;
  fieldCount?: number;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit expense"
        description="Shares are recalculated and balances update on save."
      >
        <div data-testid="dialog-body">
          {Array.from({ length: fieldCount }, (_, i) => (
            <button key={i}>Field {i}</button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

// jsdom doesn't implement scrollTo — useBodyScrollLock's cleanup calls it to
// restore the page's position, which is real, correct behavior; jsdom just
// has nothing to do with it. Stubbed so that shows up as a no-op, not noise.
window.scrollTo = () => {};

afterEach(() => {
  // This project's vitest config doesn't enable Vitest's global test hooks,
  // which is what Testing Library's automatic cleanup relies on to detect
  // the framework and register itself — without it, each render() leaks
  // into the next test's DOM. Cleaning up explicitly is what keeps
  // getByRole("button", { name: "Close" }) finding exactly one button.
  cleanup();
  // The scroll lock writes directly to document.body.style; a leftover
  // locked body would otherwise bleed into the next test too.
  document.body.style.cssText = "";
});

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(<Harness initialOpen={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the title, description, and every child when open", () => {
    render(<Harness initialOpen />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Edit expense");
    expect(dialog).toHaveAccessibleDescription(
      "Shares are recalculated and balances update on save."
    );
    expect(screen.getByText("Field 0")).toBeInTheDocument();
    expect(screen.getByText("Field 1")).toBeInTheDocument();
  });

  it("never conditionally hides content based on available height — a form with many fields renders every one", () => {
    // This is the direct regression test for the "stuck" bug: nothing in
    // the component measures space and drops content, so a very tall form
    // is exactly as fully rendered as a short one.
    render(<Harness initialOpen fieldCount={40} />);
    for (let i = 0; i < 40; i++) {
      expect(screen.getByText(`Field ${i}`)).toBeInTheDocument();
    }
  });

  it("sizes the overlay with plain CSS, never an inline style computed from the viewport", () => {
    // Regression guard for the first bug directly: the overlay must never
    // again carry a JS-computed top/height, in any environment — including
    // this one, where window.visualViewport doesn't exist at all.
    render(<Harness initialOpen />);
    const overlay = screen.getByRole("dialog").parentElement!;
    expect(overlay.getAttribute("style")).toBeNull();
    expect(overlay.className).toMatch(/(?:^|\s)h-\[100dvh\](?:\s|$)/);
  });

  it("centers the panel with auto margins, never align-items — the pattern that clips overflowing content", () => {
    // Regression guard for the second bug: align-items: center (or
    // items-center) on the overlay would silently reintroduce the
    // "top of a tall dialog is unreachable" failure.
    render(<Harness initialOpen />);
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement!;
    expect(overlay.className).not.toMatch(/items-center/);
    expect(dialog.className).toMatch(/(?:^|\s)mt-auto(?:\s|$)/);
  });

  it("has exactly one scrolling region for the whole dialog", () => {
    // Two competing scroll containers is how "scrollable, but not the part
    // you need" happens — everything from the header to Save/Cancel must
    // share a single overflow-y-auto ancestor.
    render(<Harness initialOpen fieldCount={40} />);
    const overlay = screen.getByRole("dialog").parentElement!;
    const scrollers = [overlay, ...Array.from(overlay.querySelectorAll("*"))].filter(
      (el) => el instanceof HTMLElement && /(?:^|\s)overflow-y-auto(?:\s|$)/.test(el.className)
    );
    expect(scrollers).toEqual([overlay]);
  });

  it("closes on Escape", () => {
    render(<Harness initialOpen />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when clicking the overlay outside the panel", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    const overlay = screen.getByRole("dialog").parentElement!;
    await user.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not close when clicking inside the panel", async () => {
    // The dedicated regression test for the click-outside redesign: the
    // scrim and the scroll container used to be separate layered elements,
    // and a click landing on the (non-scrim) positioning wrapper silently
    // did nothing. Now there is one element with the handler and the panel
    // stops propagation, so this has to hold in both directions.
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    await user.click(screen.getByText("Edit expense"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the panel on open", async () => {
    render(<Harness initialOpen />);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("restores focus to the trigger that opened it, on close", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen={false} />);
    const trigger = screen.getByText("Open trigger");
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("traps Tab, wrapping from the last focusable element to the first", () => {
    render(<Harness initialOpen fieldCount={2} />);
    const close = screen.getByRole("button", { name: "Close" });
    const field1 = screen.getByText("Field 1");
    field1.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("traps Shift+Tab, wrapping from the first focusable element to the last", () => {
    render(<Harness initialOpen fieldCount={2} />);
    const close = screen.getByRole("button", { name: "Close" });
    const field1 = screen.getByText("Field 1");
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(field1).toHaveFocus();
  });

  it("locks background scroll while open and restores it when it closes", async () => {
    const user = userEvent.setup();
    render(<Harness initialOpen />);
    expect(document.body.style.position).toBe("fixed");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.style.position).not.toBe("fixed");
  });
});
