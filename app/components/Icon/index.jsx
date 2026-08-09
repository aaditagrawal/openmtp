import React from 'react';

// Shared defaults keep every migrated lucide-react icon visually consistent
// with the previous @material-ui/icons look across the app.
export const ICON_DEFAULT_SIZE = 18;
export const ICON_DEFAULT_STROKE_WIDTH = 1.75;

function Icon({
  icon: LucideIcon,
  size = ICON_DEFAULT_SIZE,
  strokeWidth = ICON_DEFAULT_STROKE_WIDTH,
  ...rest
}) {
  if (!LucideIcon) {
    return null;
  }

  return <LucideIcon size={size} strokeWidth={strokeWidth} {...rest} />;
}

export { Github, Twitter, Facebook, Reddit, Paypal } from './brands';
export default Icon;
