import { describe, it, expect } from "vitest";
import { imagePaths, validImagePaths } from "./images";

const folder = "3f2b8c1e-9a4d-4e5f-8b6a-1c2d3e4f5a6b";

describe("agent page image paths", () => {
  it("accepts the paths the upload slot hands out", () => {
    const paths = imagePaths(folder, 3);
    expect(paths[2]).toBe(`agent-images/${folder}/page-3.jpg`);
    expect(validImagePaths(paths)).toEqual(paths);
  });
  it("refuses anything else", () => {
    expect(validImagePaths([])).toBeNull();
    expect(validImagePaths(imagePaths(folder, 13))).toBeNull();
    expect(validImagePaths(["market-reports/x.pdf"])).toBeNull();
    expect(validImagePaths([`agent-images/${folder}/../secret.jpg`])).toBeNull();
    expect(validImagePaths([`agent-images/${folder}/page-1.png`])).toBeNull();
    expect(validImagePaths([`agent-images/${folder}/page-1.jpg`, `agent-images/${folder.replace("3f", "4f")}/page-2.jpg`])).toBeNull();
    expect(validImagePaths([`agent-images/${folder}/page-1.jpg`, `agent-images/${folder}/page-1.jpg`])).toBeNull();
  });
});
