/**
 * FeedContextMenu Component
 * Context menu for feed actions (right-click menu)
 */

import { useEffect, useRef } from 'react';
import { Edit, RefreshCw, CheckCheck, Trash2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Feed } from '@/types/miniflux';

interface FeedContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  feed: Feed | null;
  onClose: () => void;
  onEdit: (feed: Feed) => void;
  onRefresh: (feedId: number) => void;
  onMarkAsRead: (feedId: number) => void;
  onDelete: (feedId: number) => void;
}

export function FeedContextMenu({
  isOpen,
  position,
  feed,
  onClose,
  onEdit,
  onRefresh,
  onMarkAsRead,
  onDelete,
}: FeedContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = position.x;
      let adjustedY = position.y;

      if (position.x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 8;
      }
      if (position.y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 8;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [isOpen, position]);

  if (!isOpen || !feed) return null;

  const menuItems = [
    {
      icon: Edit,
      label: 'Edit Feed',
      onClick: () => {
        onEdit(feed);
        onClose();
      },
    },
    {
      icon: RefreshCw,
      label: 'Refresh Feed',
      onClick: () => {
        onRefresh(feed.id);
        onClose();
      },
    },
    {
      icon: CheckCheck,
      label: 'Mark All as Read',
      onClick: () => {
        onMarkAsRead(feed.id);
        onClose();
      },
    },
    {
      icon: ExternalLink,
      label: 'Open Site',
      onClick: () => {
        window.open(feed.site_url, '_blank');
        onClose();
      },
    },
    { divider: true },
    {
      icon: Trash2,
      label: 'Delete Feed',
      danger: true,
      onClick: () => {
        if (confirm(`Are you sure you want to delete "${feed.title}"?`)) {
          onDelete(feed.id);
        }
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      className={cn(
        'fixed z-50 min-w-[180px] py-1',
        'bg-[var(--color-surface-base)] rounded-lg shadow-xl',
        'border border-[var(--color-border-subtle)]',
        'animate-scale-in'
      )}
      style={{ left: position.x, top: position.y, transformOrigin: 'top left' }}
    >
      {menuItems.map((item, index) => {
        if ('divider' in item) {
          return (
            <div
              key={index}
              className="my-1 border-t border-[var(--color-border-subtle)]"
            />
          );
        }

        const Icon = item.icon;
        return (
          <button
            key={index}
            onClick={item.onClick}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors',
              item.danger
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
            )}
          >
            <Icon size={16} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default FeedContextMenu;