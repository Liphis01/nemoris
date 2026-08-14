import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageMediaField } from "./QuestionEditorPrimitives";

const originalImage = globalThis.Image;
let probeSize = { height: 900, width: 1200 };

beforeEach(() => {
  probeSize = { height: 900, width: 1200 };
  URL.createObjectURL = vi.fn(() => "blob:probe");
  URL.revokeObjectURL = vi.fn();

  // jsdom never decodes images, so stand in for the natural-size probe.
  globalThis.Image = class {
    set src(value) {
      this._src = value;
      queueMicrotask(() => {
        this.naturalWidth = probeSize.width;
        this.naturalHeight = probeSize.height;
        this.onload?.();
      });
    }

    get src() {
      return this._src;
    }
  };
});

afterEach(() => {
  globalThis.Image = originalImage;
  cleanup();
});

function renderField(props = {}) {
  const onUploadFile = props.onUploadFile
    || vi.fn().mockResolvedValue({ url: "/static/pasted.png" });
  const onMediaChange = props.onMediaChange || vi.fn();

  const utils = render(
    <ImageMediaField
      media=""
      onMediaChange={onMediaChange}
      onUploadFile={onUploadFile}
      {...props}
    />
  );

  return { ...utils, onMediaChange, onUploadFile, zone: utils.container.firstChild };
}

function pasteFile(zone, file) {
  fireEvent.paste(zone, { clipboardData: { files: [file], getData: () => "" } });
}

function imageFile(type = "image/png") {
  return new File(["binary"], "image.png", { type });
}

async function flushProbe() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ImageMediaField — pasted image resolution", () => {
  it("warns when the pasted image is below the low-resolution threshold", async () => {
    probeSize = { height: 180, width: 250 };

    const { zone } = renderField();

    pasteFile(zone, imageFile());

    expect(
      await screen.findByText(/Image de petite taille \(250 × 180 px\)/)
    ).toBeTruthy();
  });

  it("stays silent for an image wide enough to survive being scaled up", async () => {
    probeSize = { height: 1200, width: 1600 };

    const { zone, onUploadFile } = renderField();

    pasteFile(zone, imageFile());

    await waitFor(() => expect(onUploadFile).toHaveBeenCalled());
    await flushProbe();

    expect(screen.queryByText(/Image de petite taille/)).toBeNull();
  });

  it("stays silent for SVG, whose intrinsic width says nothing about quality", async () => {
    probeSize = { height: 16, width: 16 };

    const { zone, onUploadFile } = renderField();

    pasteFile(zone, imageFile("image/svg+xml"));

    await waitFor(() => expect(onUploadFile).toHaveBeenCalled());
    await flushProbe();

    expect(screen.queryByText(/Image de petite taille/)).toBeNull();
  });

  it("keeps the address-paste path silent and free of an upload", async () => {
    const { zone, onMediaChange, onUploadFile } = renderField();

    fireEvent.paste(zone, {
      clipboardData: { files: [], getData: () => "https://example.com/full.png" }
    });

    await flushProbe();

    expect(onMediaChange).toHaveBeenCalledWith("https://example.com/full.png");
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(screen.queryByText(/Image de petite taille/)).toBeNull();
  });

  it("clears a previous warning once a full-resolution address is pasted", async () => {
    probeSize = { height: 180, width: 250 };

    const { zone } = renderField();

    pasteFile(zone, imageFile());
    await screen.findByText(/Image de petite taille/);

    fireEvent.paste(zone, {
      clipboardData: { files: [], getData: () => "https://example.com/full.png" }
    });

    await waitFor(() => expect(screen.queryByText(/Image de petite taille/)).toBeNull());
  });
});
