export type PopoverHorizontalPosition = {
  left: number;
  width: number;
};

export function anchoredPopoverHorizontalPosition(
  anchorRight: number,
  viewportWidth: number,
  preferredWidth = 220,
  gutter = 12,
): PopoverHorizontalPosition {
  const safeViewportWidth = Math.max(
    0,
    Number.isFinite(viewportWidth) ? viewportWidth : 0,
  );
  const safeGutter = Math.min(
    Math.max(0, Number.isFinite(gutter) ? gutter : 0),
    safeViewportWidth / 2,
  );
  const availableWidth = Math.max(0, safeViewportWidth - safeGutter * 2);
  const width = Math.min(
    Math.max(0, Number.isFinite(preferredWidth) ? preferredWidth : 0),
    availableWidth,
  );
  const requestedLeft =
    (Number.isFinite(anchorRight) ? anchorRight : safeGutter + width) - width;
  const maximumLeft = Math.max(
    safeGutter,
    safeViewportWidth - safeGutter - width,
  );

  return {
    left: Math.min(Math.max(requestedLeft, safeGutter), maximumLeft),
    width,
  };
}
