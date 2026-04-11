/**
 * SettingsModal Component
 * Redesigned settings panel with 4 tabs:
 *   Appearance — Theme, colors, feed display, book reader
 *   Content   — OPML, feed defaults, modules, retention
 *   Speech    — TTS settings
 *   System    — Account, storage, maintenance, advanced
 *
 * Desktop: sidebar + scrollable content
 * Mobile: full-screen with bottom tab bar
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Palette, Newspaper, Headphones, Settings, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';

import AppearanceSection from './sections/AppearanceSection';
import ContentSection from './sections/ContentSection';
import SpeechSection from './sections/SpeechSection';
import SystemSection from './sections/SystemSection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SettingsSection = 'appearance' | 'content' | 'speech' | 'system';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}

// ── Nav Items ─────────────────────────────────────────────────────────────────

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-5 h-5" /> },
  { id: 'content', label: 'Content', icon: <Newspaper className="w-5 h-5" /> },
  { id: 'speech', label: 'Speech', icon: <Headphones className="w-5 h-5" /> },
  { id: 'system', label: 'System', icon: <Settings className="w-5 h-5" /> },
];

// ── Section Router ────────────────────────────────────────────────────────────

function renderSection(section: SettingsSection) {
  switch (section) {
    case 'appearance':
      return <AppearanceSection />;
    case 'content':
      return <ContentSection />;
    case 'speech':
      return <SpeechSection />;
    case 'system':
      return <SystemSection />;
    default:
      return <AppearanceSection />;
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialSection = 'appearance',
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) setActiveSection(initialSection);
  }, [isOpen, initialSection]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  // ── Mobile: Full-screen ─────────────────────────────────────────────────
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-[var(--color-surface-app)] flex flex-col animate-slide-up-full">
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 px-2 py-2',
            'bg-[var(--color-surface-glass)] backdrop-blur-xl',
            'border-b border-[var(--color-border-subtle)]',
            'pt-[calc(8px+env(safe-area-inset-top))]',
            'eink-shell-surface',
          )}
        >
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-base font-semibold text-[var(--color-text-primary)]">
            {navItems.find((n) => n.id === activeSection)?.label ?? 'Settings'}
          </h1>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))]">
          <div className="p-4">{renderSection(activeSection)}</div>
        </div>

        {/* Bottom Tab Bar */}
        <div
          className={cn(
            'fixed bottom-0 left-0 right-0 z-50',
            'bg-[var(--color-surface-glass)] backdrop-blur-xl',
            'border-t border-[var(--color-border-subtle)]',
            'pb-[env(safe-area-inset-bottom)]',
            'eink-shell-surface',
          )}
        >
          <div className="flex items-center justify-around px-2 py-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[56px]',
                  activeSection === item.id
                    ? 'text-[var(--color-accent-fg)]'
                    : 'text-[var(--color-text-tertiary)]',
                )}
              >
                {item.icon}
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Desktop: Sidebar + Panel ────────────────────────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in eink-modal-backdrop"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden flex animate-scale-in eink-shell-surface eink-modal-surface">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 bg-[var(--color-surface-secondary)] border-r border-[var(--color-border-subtle)] p-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Settings</h2>
          </div>

          <nav className="space-y-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeSection === item.id
                    ? 'bg-[var(--color-interactive-bg)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header with close */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-subtle)]">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {navItems.find((n) => n.id === activeSection)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-5">{renderSection(activeSection)}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SettingsModal;
