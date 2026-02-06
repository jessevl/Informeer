/**
 * SettingsModal Component
 * Full-featured settings modal with sidebar navigation
 * Based on Planneer's SettingsModal pattern
 * Mobile: Full-screen with bottom navigation
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Settings, User, Palette, LayoutList, LogOut, ChevronRight, Download, Upload, FileText, Check, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@frameer/hooks/useMobileDetection';
import { useSettingsStore, type Theme, type ThemeVariant, type AccentColor, type ViewMode } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { miniflux } from '@/api/miniflux';
import { useFeedsStore } from '@/stores/feeds';

// ============================================================================
// TYPES
// ============================================================================
export type SettingsSection = 'general' | 'appearance' | 'reading' | 'account';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}

// ============================================================================
// NAV ITEMS
// ============================================================================
interface NavItemDef {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItemDef[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-5 h-5" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-5 h-5" /> },
  { id: 'reading', label: 'Reading', icon: <LayoutList className="w-5 h-5" /> },
  { id: 'account', label: 'Account', icon: <User className="w-5 h-5" /> },
];

// ============================================================================
// GENERAL SETTINGS SECTION - OPML Import/Export
// ============================================================================
const GeneralSettings: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { fetchFeeds, fetchCategories } = useFeedsStore();

  // Clear success/error states after a delay
  useEffect(() => {
    if (exportSuccess || importSuccess || error) {
      const timer = setTimeout(() => {
        setExportSuccess(false);
        setImportSuccess(false);
        setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [exportSuccess, importSuccess, error]);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      const opmlContent = await miniflux.exportOPML();
      
      // Create and download the file
      const blob = new Blob([opmlContent], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `miniflux-feeds-${new Date().toISOString().split('T')[0]}.opml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setExportSuccess(true);
    } catch (err) {
      console.error('Failed to export OPML:', err);
      setError(err instanceof Error ? err.message : 'Failed to export feeds');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.opml') && !file.name.endsWith('.xml')) {
      setError('Please select a valid OPML or XML file');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const content = await file.text();
      await miniflux.importOPML(content);
      
      // Refresh feeds and categories after import
      await Promise.all([fetchFeeds(), fetchCategories()]);
      
      setImportSuccess(true);
    } catch (err) {
      console.error('Failed to import OPML:', err);
      setError(err instanceof Error ? err.message : 'Failed to import feeds');
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">General</h3>
        <p className="text-sm text-[var(--color-text-tertiary)]">Import and export your feed subscriptions</p>
      </div>

      {/* OPML Import/Export Section */}
      <div className="space-y-4">
        <h4 className="text-sm font-medium text-[var(--color-text-secondary)]">
          Feed Management
        </h4>

        {/* Status Messages */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        {exportSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
            <Check size={16} />
            Feeds exported successfully!
          </div>
        )}
        {importSuccess && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
            <Check size={16} />
            Feeds imported successfully!
          </div>
        )}

        {/* Export Button */}
        <div className="bg-[var(--color-surface-secondary)] rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Download size={16} className="text-[var(--color-text-secondary)]" />
                <h5 className="text-sm font-medium text-[var(--color-text-primary)]">Export Feeds</h5>
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Download all your feed subscriptions as an OPML file. This file can be imported into other RSS readers.
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                "bg-[var(--color-accent-primary)] text-white",
                "hover:bg-[var(--color-accent-hover)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isExporting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <FileText size={16} />
                  Export OPML
                </>
              )}
            </button>
          </div>
        </div>

        {/* Import Button */}
        <div className="bg-[var(--color-surface-secondary)] rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Upload size={16} className="text-[var(--color-text-secondary)]" />
                <h5 className="text-sm font-medium text-[var(--color-text-primary)]">Import Feeds</h5>
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Import feeds from an OPML file. Existing feeds will be preserved, and new feeds will be added.
              </p>
            </div>
            <button
              onClick={handleImportClick}
              disabled={isImporting}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                "bg-[var(--color-surface-tertiary)] text-[var(--color-text-primary)]",
                "hover:bg-[var(--color-surface-hover)]",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isImporting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Import OPML
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".opml,.xml"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// APPEARANCE SETTINGS SECTION (now includes all color options)
// ============================================================================
const AppearanceSettings: React.FC = () => {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const setThemeVariant = useSettingsStore((s) => s.setThemeVariant);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  
  // Accent color options with display info
  const accentOptions: { value: AccentColor; label: string; color: string; darkColor: string }[] = [
    { value: null, label: 'Auto', color: themeVariant === 'warm' ? '#78716c' : '#3b82f6', darkColor: themeVariant === 'warm' ? '#a8a29e' : '#58a6ff' },
    { value: 'amber', label: 'Amber', color: '#f59e0b', darkColor: '#fbbf24' },
    { value: 'blue', label: 'Blue', color: '#3b82f6', darkColor: '#58a6ff' },
    { value: 'green', label: 'Green', color: '#22c55e', darkColor: '#4ade80' },
    { value: 'red', label: 'Red', color: '#ef4444', darkColor: '#f87171' },
    { value: 'purple', label: 'Purple', color: '#a855f7', darkColor: '#c084fc' },
    { value: 'pink', label: 'Pink', color: '#ec4899', darkColor: '#f472b6' },
    { value: 'teal', label: 'Teal', color: '#14b8a6', darkColor: '#2dd4bf' },
    { value: 'stone', label: 'Stone', color: '#78716c', darkColor: '#a8a29e' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Appearance</h3>
        <p className="text-sm text-[var(--color-text-tertiary)]">Customize colors and visual style</p>
      </div>

      {/* Theme */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
          Theme
        </label>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as Theme[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                theme === t
                  ? 'bg-[var(--color-interactive-bg)] text-[var(--color-interactive-text)] ring-1 ring-[var(--color-interactive-ring)]'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
              )}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Theme Variant */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
          Color Style
        </label>
        <div className="flex gap-2">
          {([
            { value: 'warm', label: 'Warm', description: 'Stone & earth tones' },
            { value: 'cool', label: 'Cool', description: 'Blue & gray tones' },
          ] as const).map((v) => (
            <button
              key={v.value}
              onClick={() => setThemeVariant(v.value)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                themeVariant === v.value
                  ? 'bg-[var(--color-interactive-bg)] text-[var(--color-interactive-text)] ring-1 ring-[var(--color-interactive-ring)]'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-tertiary)]'
              )}
              title={v.description}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
          {themeVariant === 'warm' 
            ? 'Paper-like warm neutrals with stone accents'
            : 'GitHub-inspired blues and cool grays'}
        </p>
      </div>

      {/* Accent Color */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
          Accent Color
        </label>
        <div className="flex flex-wrap gap-2">
          {accentOptions.map((option) => {
            const isSelected = accentColor === option.value;
            return (
              <button
                key={option.value ?? 'auto'}
                onClick={() => setAccentColor(option.value)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  'bg-[var(--color-surface-secondary)]',
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-offset-[var(--color-surface-base)] ring-[var(--color-accent-primary)]'
                    : 'hover:bg-[var(--color-surface-tertiary)]'
                )}
                title={option.label}
              >
                <span 
                  className="w-4 h-4 rounded-full shadow-sm"
                  style={{ 
                    background: `linear-gradient(135deg, ${option.color} 0%, ${option.darkColor} 100%)`,
                  }}
                />
                <span className="text-[var(--color-text-secondary)]">
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
          {accentColor === null 
            ? `Using theme default (${themeVariant === 'warm' ? 'stone' : 'blue'})`
            : `Custom accent: ${accentColor.charAt(0).toUpperCase() + accentColor.slice(1)}`}
        </p>
      </div>
    </div>
  );
};

// ============================================================================
// READING SETTINGS SECTION
// ============================================================================
const ReadingSettings: React.FC = () => {
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const showArticleImages = useSettingsStore((s) => s.showArticleImages);
  const setShowArticleImages = useSettingsStore((s) => s.setShowArticleImages);
  const magazineExcerptLines = useSettingsStore((s) => s.magazineExcerptLines);
  const setMagazineExcerptLines = useSettingsStore((s) => s.setMagazineExcerptLines);
  const cardsExcerptLines = useSettingsStore((s) => s.cardsExcerptLines);
  const setCardsExcerptLines = useSettingsStore((s) => s.setCardsExcerptLines);
  const autoReaderView = useSettingsStore((s) => s.autoReaderView);
  const setAutoReaderView = useSettingsStore((s) => s.setAutoReaderView);

  const viewModeOptions: { value: ViewMode; label: string; description: string }[] = [
    { value: 'list', label: 'List', description: 'Compact list with titles and excerpts' },
    { value: 'cards', label: 'Cards', description: 'Grid of visual cards with images' },
    { value: 'magazine', label: 'Magazine', description: 'Full-width article previews' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Reading</h3>
        <p className="text-sm text-[var(--color-text-tertiary)]">Customize your reading experience</p>
      </div>

      {/* View Mode */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-3">
          Article List View
        </label>
        <div className="space-y-2">
          {viewModeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setViewMode(option.value)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors',
                viewMode === option.value
                  ? 'bg-[var(--color-interactive-bg)] ring-1 ring-[var(--color-interactive-ring)]'
                  : 'bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)]'
              )}
            >
              <div>
                <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                  {option.label}
                </span>
                <span className="block text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {option.description}
                </span>
              </div>
              {viewMode === option.value && (
                <div className="w-2 h-2 rounded-full bg-[var(--color-accent-primary)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Show Images */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)]">
            Show Article Images
          </label>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Display cover images in cards and magazine view
          </p>
        </div>
        <button
          onClick={() => setShowArticleImages(!showArticleImages)}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors',
            showArticleImages 
              ? 'bg-[var(--color-accent-primary)]' 
              : 'bg-[var(--color-surface-tertiary)]'
          )}
        >
          <span 
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
              showArticleImages ? 'left-6' : 'left-1'
            )}
          />
        </button>
      </div>

      {/* Auto Reader View */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)]">
            Auto Reader View
          </label>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Automatically fetch full article content when opening
          </p>
        </div>
        <button
          onClick={() => setAutoReaderView(!autoReaderView)}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors',
            autoReaderView 
              ? 'bg-[var(--color-accent-primary)]' 
              : 'bg-[var(--color-surface-tertiary)]'
          )}
        >
          <span 
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
              autoReaderView ? 'left-6' : 'left-1'
            )}
          />
        </button>
      </div>

      {/* Magazine Excerpt Lines - only show when magazine view is selected */}
      {viewMode === 'magazine' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                Excerpt Length
              </label>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                Number of lines shown in magazine view ({magazineExcerptLines} lines)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[var(--color-text-tertiary)]">3</span>
            <input
              type="range"
              min={3}
              max={10}
              value={magazineExcerptLines}
              onChange={(e) => setMagazineExcerptLines(parseInt(e.target.value))}
              className="flex-1 h-2 rounded-full bg-[var(--color-surface-tertiary)] appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent-primary)]
                [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full 
                [&::-moz-range-thumb]:bg-[var(--color-accent-primary)] [&::-moz-range-thumb]:border-0"
            />
            <span className="text-xs text-[var(--color-text-tertiary)]">10</span>
          </div>
        </div>
      )}

      {/* Cards Excerpt Lines - only show when cards view is selected */}
      {viewMode === 'cards' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                Excerpt Length
              </label>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                Number of lines shown in cards view ({cardsExcerptLines} lines)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[var(--color-text-tertiary)]">2</span>
            <input
              type="range"
              min={2}
              max={6}
              value={cardsExcerptLines}
              onChange={(e) => setCardsExcerptLines(parseInt(e.target.value))}
              className="flex-1 h-2 rounded-full bg-[var(--color-surface-tertiary)] appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent-primary)]
                [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer
                [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full 
                [&::-moz-range-thumb]:bg-[var(--color-accent-primary)] [&::-moz-range-thumb]:border-0"
            />
            <span className="text-xs text-[var(--color-text-tertiary)]">6</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ACCOUNT SETTINGS SECTION
// ============================================================================
const AccountSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, serverUrl, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    onClose();
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Account</h3>
        <p className="text-sm text-[var(--color-text-tertiary)]">Manage your Miniflux connection</p>
      </div>

      {/* Server Info */}
      <div className="bg-[var(--color-surface-secondary)] rounded-xl p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-tertiary)] mb-1">
            Server
          </label>
          <p className="text-sm text-[var(--color-text-primary)] truncate">
            {serverUrl}
          </p>
        </div>
        {user && (
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-tertiary)] mb-1">
              Logged in as
            </label>
            <p className="text-sm text-[var(--color-text-primary)]">
              {user.username}
            </p>
          </div>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
      >
        <LogOut size={18} />
        Sign Out
      </button>
    </div>
  );
};

// ============================================================================
// MAIN SETTINGS MODAL
// ============================================================================
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialSection = 'general',
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveSection(initialSection);
    }
  }, [isOpen, initialSection]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />;
      case 'appearance':
        return <AppearanceSettings />;
      case 'reading':
        return <ReadingSettings />;
      case 'account':
        return <AccountSettings onClose={onClose} />;
      default:
        return <GeneralSettings />;
    }
  };

  // Mobile: Full screen layout
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-[var(--color-surface-app)] flex flex-col animate-slide-up-full">
        {/* Mobile Header */}
        <div className={cn(
          "flex items-center gap-2 px-2 py-2",
          "bg-[var(--color-surface-glass)] backdrop-blur-xl",
          "border-b border-[var(--color-border-subtle)]",
          "pt-[calc(8px+env(safe-area-inset-top))]"
        )}>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-base font-semibold text-[var(--color-text-primary)]">Settings</h1>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-[calc(80px+env(safe-area-inset-bottom))]">
          <div className="p-4">
            {renderContent()}
          </div>
        </div>
        
        {/* Bottom Tab Bar */}
        <div className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "bg-[var(--color-surface-glass)] backdrop-blur-xl",
          "border-t border-[var(--color-border-subtle)]",
          "pb-[env(safe-area-inset-bottom)]"
        )}>
          <div className="flex items-center justify-around px-2 py-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors min-w-[60px]',
                  activeSection === item.id
                    ? 'text-[var(--color-accent-fg)]'
                    : 'text-[var(--color-text-tertiary)]'
                )}
              >
                {item.icon}
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Desktop: Modal layout
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden flex animate-scale-in">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-[var(--color-surface-secondary)] border-r border-[var(--color-border-subtle)] p-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Settings</h2>
          </div>
          
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  activeSection === item.id
                    ? 'bg-[var(--color-interactive-bg)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
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
          {/* Header with close button */}
          <div className="flex items-center justify-end p-4 border-b border-[var(--color-border-subtle)]">
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-6">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsModal;
