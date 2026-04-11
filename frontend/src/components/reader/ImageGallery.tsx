/**
 * ImageGallery Component
 * Full-screen image gallery overlay with swipe navigation.
 * Triggered when a user taps an image in an article.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageGalleryProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageGallery({ images, initialIndex, onClose }: ImageGalleryProps) {
  const [current, setCurrent] = useState(initialIndex);
  const touchRef = useRef({ startX: 0, startY: 0, swiping: false });

  const goNext = useCallback(() => {
    if (current < images.length - 1) setCurrent(i => i + 1);
  }, [current, images.length]);

  const goPrev = useCallback(() => {
    if (current > 0) setCurrent(i => i - 1);
  }, [current]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goNext, goPrev]);

  // Touch swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, swiping: false };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchRef.current.startX;
    const dy = e.changedTouches[0].clientY - touchRef.current.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) goNext();
      else goPrev();
    } else if (Math.abs(dy) > 100 && dy > 0) {
      // Swipe down to close
      onClose();
    }
  }, [goNext, goPrev, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex flex-col animate-fade-in"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white/80">
        <span className="text-sm tabular-nums">
          {current + 1} / {images.length}
        </span>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors">
          <X size={20} />
        </button>
      </div>

      {/* Image */}
      <div className="flex-1 flex items-center justify-center px-4 min-h-0">
        <img
          src={images[current]}
          alt=""
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
      </div>

      {/* Navigation arrows (desktop) */}
      {current > 0 && (
        <button
          onClick={goPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white/80 hover:bg-black/60 transition-colors hidden md:flex items-center justify-center"
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {current < images.length - 1 && (
        <button
          onClick={goNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white/80 hover:bg-black/60 transition-colors hidden md:flex items-center justify-center"
        >
          <ChevronRight size={24} />
        </button>
      )}

      {/* Dot indicators */}
      {images.length > 1 && images.length <= 20 && (
        <div className="flex items-center justify-center gap-1.5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={cn(
                'w-1.5 h-1.5 rounded-full transition-all',
                i === current ? 'bg-white w-3' : 'bg-white/40'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
