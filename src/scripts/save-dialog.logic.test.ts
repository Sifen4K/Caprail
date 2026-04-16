import { describe, expect, it } from "vitest";
import { buildDefaultSavePath, extractDirectoryPath } from "./save-dialog.logic";

describe("buildDefaultSavePath", () => {
  it("joins a Windows directory with a filename", () => {
    expect(buildDefaultSavePath("C:\\Users\\test\\Pictures\\Caprail", "screenshot.png"))
      .toBe("C:\\Users\\test\\Pictures\\Caprail\\screenshot.png");
  });

  it("joins a POSIX-style directory with a filename", () => {
    expect(buildDefaultSavePath("/tmp/caprail", "recording-export.mp4"))
      .toBe("/tmp/caprail/recording-export.mp4");
  });

  it("falls back to the filename when the configured directory is empty", () => {
    expect(buildDefaultSavePath("", "screenshot.png")).toBe("screenshot.png");
  });
});

describe("extractDirectoryPath", () => {
  it("extracts a Windows parent directory from a file path", () => {
    expect(extractDirectoryPath("C:\\Users\\test\\Pictures\\Caprail\\shot.png"))
      .toBe("C:\\Users\\test\\Pictures\\Caprail");
  });

  it("extracts a POSIX parent directory from a file path", () => {
    expect(extractDirectoryPath("/tmp/caprail/shot.png")).toBe("/tmp/caprail");
  });

  it("preserves root directories", () => {
    expect(extractDirectoryPath("C:\\shot.png")).toBe("C:\\");
    expect(extractDirectoryPath("/shot.png")).toBe("/");
  });

  it("returns null when no directory is present", () => {
    expect(extractDirectoryPath("shot.png")).toBeNull();
  });
});
