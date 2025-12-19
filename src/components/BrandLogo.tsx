import { useEffect, useState } from 'react';
import logoLight from '@/assets/signup-assist-logo-light.svg';
import logoDark from '@/assets/signup-assist-logo-dark.svg';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Force a specific variant regardless of theme */
  variant?: 'light' | 'dark' | 'auto';
}

const sizeMap = {
  sm: 24,
  md: 32,
  lg: 48,
  xl: 64,
} as const;

/**
 * SignupAssist brand logo component
 * Auto-switches between light and dark variants based on system theme
 */
export function BrandLogo({ size = 'md', className = '', variant = 'auto' }: BrandLogoProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (variant !== 'auto') return;

    // Check for dark mode
    const checkDarkMode = () => {
      const isDarkMode = 
        document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(isDarkMode);
    };

    checkDarkMode();

    // Listen for theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    // Also observe class changes on documentElement for manual theme toggles
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      mediaQuery.removeEventListener('change', checkDarkMode);
      observer.disconnect();
    };
  }, [variant]);

  const selectedVariant = variant === 'auto' ? (isDark ? 'dark' : 'light') : variant;
  const logoSrc = selectedVariant === 'dark' ? logoDark : logoLight;
  const pixelSize = sizeMap[size];

  return (
    <img
      src={logoSrc}
      alt="SignupAssist"
      width={pixelSize}
      height={pixelSize}
      className={className}
      style={{ width: pixelSize, height: pixelSize }}
    />
  );
}
