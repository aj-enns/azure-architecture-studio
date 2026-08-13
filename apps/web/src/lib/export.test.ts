import { describe, expect, it } from 'vitest';
import { calculateExportLayout } from './export.js';

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe('calculateExportLayout', () => {
  it('fits all content independently of the live pan and zoom', () => {
    const layout = calculateExportLayout(
      rect(100, 50, 500, 400),
      [rect(50, 0, 200, 100), rect(450, 250, 200, 200)],
      0.5,
      40,
    );

    expect(layout).toEqual({
      width: 1280,
      height: 980,
      transform: 'translate(140px, 140px) scale(1)',
    });
  });

  it('ignores nodes with no rendered area', () => {
    const layout = calculateExportLayout(
      rect(0, 0, 800, 600),
      [rect(120, 80, 0, 0), rect(200, 150, 160, 60)],
      1,
      20,
    );

    expect(layout).toEqual({
      width: 200,
      height: 100,
      transform: 'translate(-180px, -130px) scale(1)',
    });
  });

  it('returns null when there is no exportable content', () => {
    expect(calculateExportLayout(rect(0, 0, 800, 600), [], 1)).toBeNull();
    expect(calculateExportLayout(rect(0, 0, 800, 600), [rect(10, 10, 20, 20)], 0)).toBeNull();
  });
});