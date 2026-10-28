import { afterEach, describe, expect, it, vi } from "vitest";
import {
  constructionStage,
  createSpriteSet,
  validateSpriteDefinitions,
  type Facing,
} from "../../src/render/sprites";

const facings: readonly Facing[] = ["up", "down", "left", "right"];

function installCanvasStub() {
  const contexts: Array<{
    fillStyle: string;
    imageSmoothingEnabled: boolean;
    drawnStyles: string[];
    fillRect: ReturnType<typeof vi.fn>;
  }> = [];

  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      const context = {
        fillStyle: "",
        imageSmoothingEnabled: true,
        drawnStyles: [] as string[],
        fillRect: vi.fn(),
      };
      context.fillRect.mockImplementation(() => {
        context.drawnStyles.push(context.fillStyle);
      });
      contexts.push(context);
      return {
        width: 0,
        height: 0,
        getContext: (kind: string) => (kind === "2d" ? context : null),
      } as unknown as HTMLCanvasElement;
    },
  });

  return contexts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sprite definitions", () => {
  it("validates all maps without a DOM", () => {
    expect(() => validateSpriteDefinitions()).not.toThrow();
  });

  it("creates four varied settler palettes with two walk frames", () => {
    const contexts = installCanvasStub();
    const sprites = createSpriteSet();

    for (const [facingIndex, facing] of facings.entries()) {
      const variants = sprites.followers[facing];
      expect(variants).toHaveLength(4);
      for (const [variantIndex, frames] of variants.entries()) {
        expect(frames).toHaveLength(2);
        for (const frame of frames) {
          expect(frame.width).toBeGreaterThanOrEqual(8);
          expect(frame.width).toBeLessThanOrEqual(10);
          expect(frame.height).toBeGreaterThanOrEqual(11);
          expect(frame.height).toBeLessThanOrEqual(13);
        }

        const contextIndex = facingIndex * 8 + variantIndex * 2;
        const first = contexts[contextIndex]!;
        const second = contexts[contextIndex + 1]!;
        expect(first.fillRect.mock.calls).not.toEqual(
          second.fillRect.mock.calls,
        );
        expect(
          first.drawnStyles.filter((color) => color === "#527ba0"),
        ).toHaveLength(1);
        if (variantIndex > 0) {
          expect(first.drawnStyles).not.toEqual(
            contexts[facingIndex * 8]!.drawnStyles,
          );
        }
      }
    }
    expect(contexts.every((context) => !context.imageSmoothingEnabled)).toBe(
      true,
    );
  });

  it("creates three increasingly substantial house tiers", () => {
    installCanvasStub();
    const { houses } = createSpriteSet();

    expect(houses).toHaveLength(3);
    expect(houses.map((house) => [house.width, house.height])).toEqual([
      [26, 27],
      [34, 33],
      [44, 41],
    ]);
  });

  it("creates masonry materials and three distinct construction stages", () => {
    const contexts = installCanvasStub();
    const { construction } = createSpriteSet();

    expect(construction.map((stage) => [stage.width, stage.height])).toEqual([
      [26, 12],
      [26, 27],
      [26, 27],
    ]);
    expect(contexts[32]?.drawnStyles).toContain("#c2bda3");
    expect(contexts[32]?.drawnStyles).toContain("#694637");
    expect(contexts[32]?.drawnStyles).toContain("#75a7ad");
    expect(contexts[35]?.fillRect.mock.calls).not.toEqual(
      contexts[36]?.fillRect.mock.calls,
    );
  });

  it("maps dwell progress to foundation, frame, and unfinished masonry", () => {
    expect(constructionStage(1)).toBe(0);
    expect(constructionStage(19)).toBe(0);
    expect(constructionStage(20)).toBe(1);
    expect(constructionStage(44)).toBe(1);
    expect(constructionStage(45)).toBe(2);
    expect(constructionStage(60)).toBe(2);
  });

  it("creates terrain features with meaningful vertical silhouettes", () => {
    installCanvasStub();
    const { rocks, trees } = createSpriteSet();

    expect(rocks.map((rock) => [rock.width, rock.height])).toEqual([[20, 18]]);
    expect(trees.map((tree) => [tree.width, tree.height])).toEqual([
      [18, 28],
      [24, 28],
    ]);
  });
});
