/**
 * MobileDrawer Component
 * Slide-out drawer for mobile sidebar navigation
 * Slides in from the left with backdrop
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export function MobileDrawer({
  isOpen,
  onClose,
  children,
  className,
}: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      const focusable = drawerRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        (focusable[0] as HTMLElement).focus();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0',
          'bg-black/50 backdrop-blur-sm',
          'animate-backdrop-in'
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer Panel */}
      <div
        ref={drawerRef}
        className={cn(
          'absolute top-0 left-0 bottom-0',
          'w-[85vw] max-w-[320px]',
          'bg-[var(--color-surface-app)]',
          'shadow-2xl',
          'overflow-y-auto',
          'pt-[env(safe-area-inset-top)]',
          'pb-[env(safe-area-inset-bottom)]',
          'animate-slide-in-left',
          className
        )}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={cn(
            'absolute top-3 right-3 z-10',
            'w-8 h-8 rounded-full',
            'flex items-center justify-center',
            'bg-[var(--color-surface-secondary)]',
            'text-[var(--color-text-secondary)]',
            'hover:bg-[var(--color-surface-hover)]',
            'transition-colors'
          )}
          aria-label="Close drawer"
        >
          <X size={18} />
        </button>
        
        {/* Content */}
        <div className="h-full">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MobileDrawer;