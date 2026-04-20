/**
 * Content Section
 * OPML import/export, feed defaults, modules, article retention
 * Mix of client-side settings and server-side settings (with save button)
 */

import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Download,
  Upload,
  Loader2,
  Eye,
  EyeOff,
  Newspaper,
  Library,
  BookOpen,
} from 'lucide-react';
import { api } from '@/api/client';
import { useFeedsStore } from '@/stores/feeds';
import { useModulesStore } from '@/stores/modules';
import {
  Toggle,
  ToggleRow,
  SliderRow,
  SectionHeader,
  Separator,
  Card,
  StatusMessage,
  SaveButton,
  NumberInput,
  inputClass,
} from '../ui';

// ── Component ─────────────────────────────────────────────────────────────────

const ContentSection: React.FC = () => {
  // ── OPML state ─────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [opmlMessage, setOpmlMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { fetchFeeds, fetchCategories } = useFeedsStore();

  // ── Feed defaults ──────────────────────────────────────────────────────
  const [defaultFetchPolicy, setDefaultFetchPolicy] = useState<'always' | 'rss_only'>('always');
  const [fetchPolicyLoaded, setFetchPolicyLoaded] = useState(false);

  // ── Module state ───────────────────────────────────────────────────────
  const [nrcEnabled, setNrcEnabled] = useState(false);
  const [nrcEmail, setNrcEmail] = useState('');
  const [nrcPassword, setNrcPassword] = useState('');
  const [nrcFeedDays, setNrcFeedDays] = useState(14);
  const [nrcPreCachePdfs, setNrcPreCachePdfs] = useState(true);
  const [showNrcPassword, setShowNrcPassword] = useState(false);
  const [magEnabled, setMagEnabled] = useState(false);
  const [magMaxIssues, setMagMaxIssues] = useState(10);
  const [magPreCachePdfs, setMagPreCachePdfs] = useState(false);
  const [booksEnabled, setBooksEnabled] = useState(false);
  const [booksZlibEnabled, setBooksZlibEnabled] = useState(true);
  const [zlibMirror, setZlibMirror] = useState('z-lib.fm');
  const [zlibDailyLimit, setZlibDailyLimit] = useState(5);
  const [zlibEmail, setZlibEmail] = useState('');
  const [zlibPassword, setZlibPassword] = useState('');

  // ── Retention state ────────────────────────────────────────────────────
  const [maxAgeDays, setMaxAgeDays] = useState(180);
  const [maxEntriesPerFeed, setMaxEntriesPerFeed] = useState(500);
  const [keepStarred, setKeepStarred] = useState(true);

  // ── Save state ─────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Load all server settings on mount ──────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const s = await api.getSettings() as any;
        // Feed defaults
        if (s.feeds?.default_content_fetch_policy) setDefaultFetchPolicy(s.feeds.default_content_fetch_policy);
        setFetchPolicyLoaded(true);
        // Modules: NRC
        if (s.modules?.nrc?.enabled != null) setNrcEnabled(s.modules.nrc.enabled === true);
        if (s.modules?.nrc?.email) setNrcEmail(s.modules.nrc.email);
        if (s.modules?.nrc?.feed_days) setNrcFeedDays(Number(s.modules.nrc.feed_days));
        if (s.modules?.nrc?.pre_cache_pdfs != null) setNrcPreCachePdfs(s.modules.nrc.pre_cache_pdfs !== false);
        // Modules: MagazineLib
        if (s.modules?.magazinelib?.enabled != null) setMagEnabled(s.modules.magazinelib.enabled === true);
        if (s.modules?.magazinelib?.max_issues) setMagMaxIssues(Number(s.modules.magazinelib.max_issues));
        if (s.modules?.magazinelib?.pre_cache_pdfs != null) setMagPreCachePdfs(s.modules.magazinelib.pre_cache_pdfs === true);
        // Modules: Books
        if (s.modules?.books?.enabled != null) setBooksEnabled(s.modules.books.enabled === true);
        if (s.modules?.books?.zlib_enabled != null) setBooksZlibEnabled(s.modules.books.zlib_enabled !== false);
        if (s.modules?.books?.zlib_mirror) setZlibMirror(s.modules.books.zlib_mirror as string);
        if (s.modules?.books?.zlib_daily_limit != null) setZlibDailyLimit(Number(s.modules.books.zlib_daily_limit));
        if (s.modules?.books?.zlib_email) setZlibEmail(s.modules.books.zlib_email as string);
        // Retention
        if (s.retention?.max_age_days != null) setMaxAgeDays(Number(s.retention.max_age_days));
        if (s.retention?.max_entries_per_feed != null) setMaxEntriesPerFeed(Number(s.retention.max_entries_per_feed));
        if (s.retention?.keep_starred != null) setKeepStarred(s.retention.keep_starred === true || s.retention.keep_starred === 'true' as any);
      } catch (err) {
        console.error('[content] Failed to load settings:', err);
        setError('Failed to load settings');
      }
    };
    load();
  }, []);

  // ── Clear transient messages ───────────────────────────────────────────
  useEffect(() => {
    if (opmlMessage) {
      const t = setTimeout(() => setOpmlMessage(null), 3000);
      return () => clearTimeout(t);
    }
  }, [opmlMessage]);

  // ── OPML handlers ──────────────────────────────────────────────────────
  const handleExport = async () => {
    setIsExporting(true);
    setOpmlMessage(null);
    try {
      const opmlContent = await api.exportOPML();
      const blob = new Blob([opmlContent], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informeer-feeds-${new Date().toISOString().split('T')[0]}.opml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setOpmlMessage({ type: 'success', text: 'Exported successfully' });
    } catch (err) {
      setOpmlMessage({ type: 'error', text: err instanceof Error ? err.message : 'Export failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.opml') && !file.name.endsWith('.xml')) {
      setOpmlMessage({ type: 'error', text: 'Please select a valid OPML or XML file' });
      return;
    }
    setIsImporting(true);
    setOpmlMessage(null);
    try {
      const content = await file.text();
      await api.importOPML(content);
      await Promise.all([fetchFeeds(), fetchCategories()]);
      setOpmlMessage({ type: 'success', text: 'Imported successfully' });
    } catch (err) {
      setOpmlMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Feed default auto-save ─────────────────────────────────────────────
  const handleFetchPolicyChange = async (policy: 'always' | 'rss_only') => {
    setDefaultFetchPolicy(policy);
    try {
      await api.updateSettings({ 'feeds.default_content_fetch_policy': policy });
    } catch (err) {
      console.error('[content] Failed to save fetch policy:', err);
    }
  };

  // ── Combined server save (modules + retention) ─────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updates: Record<string, unknown> = {
        // Modules: NRC
        'modules.nrc.enabled': nrcEnabled,
        'modules.nrc.email': nrcEmail,
        'modules.nrc.feed_days': nrcFeedDays,
        'modules.nrc.pre_cache_pdfs': nrcPreCachePdfs,
        // Modules: MagazineLib
        'modules.magazinelib.enabled': magEnabled,
        'modules.magazinelib.max_issues': magMaxIssues,
        'modules.magazinelib.pre_cache_pdfs': magPreCachePdfs,
        // Modules: Books
        'modules.books.enabled': booksEnabled,
        'modules.books.zlib_enabled': booksZlibEnabled,
        'modules.books.zlib_mirror': zlibMirror,
        'modules.books.zlib_daily_limit': zlibDailyLimit,
        'modules.books.zlib_email': zlibEmail,
        // Retention
        'retention.max_age_days': maxAgeDays,
        'retention.max_entries_per_feed': maxEntriesPerFeed,
        'retention.keep_starred': keepStarred,
      };
      if (nrcPassword) updates['modules.nrc.password'] = nrcPassword;
      if (zlibPassword) updates['modules.books.zlib_password'] = zlibPassword;
      await api.updateSettings(updates);
      await useModulesStore.getState().fetchModules();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('[content] Failed to save:', err);
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Status ─────────────────────────────────────────────── */}
      {error && <StatusMessage type="error" message={error} />}
      {opmlMessage && <StatusMessage type={opmlMessage.type} message={opmlMessage.text} />}

      {/* ── Feed Management ────────────────────────────────────── */}
      <SectionHeader title="Feed Management" />

      <div className="flex gap-2">
        <button
          onClick={handleExport}
          disabled={isExporting}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
            'hover:bg-[var(--color-surface-hover)]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export OPML
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
            'hover:bg-[var(--color-surface-hover)]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Import OPML
        </button>
        <input ref={fileInputRef} type="file" accept=".opml,.xml" onChange={handleImport} className="hidden" />
      </div>

      {/* Feed default policy */}
      {fetchPolicyLoaded && (
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-[var(--color-text-primary)]">Full-Page Fetch</span>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Default content fetch policy for new feeds</p>
          </div>
          <select
            value={defaultFetchPolicy}
            onChange={(e) => handleFetchPolicyChange(e.target.value as 'always' | 'rss_only')}
            className="text-sm rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)] px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--color-interactive-ring)]"
          >
            <option value="always">Always fetch</option>
            <option value="rss_only">On open only</option>
          </select>
        </div>
      )}

      <Separator />

      {/* ── Retention ──────────────────────────────────────────── */}
      <SectionHeader title="Article Retention" description="Controls automatic cleanup of old content" />

      <SliderRow
        label="Maximum Article Age"
        value={maxAgeDays}
        min={7}
        max={730}
        formatValue={(v) => `${v} days`}
        onChange={setMaxAgeDays}
      />

      <SliderRow
        label="Entries per Feed"
        description="Maximum entries to keep per feed"
        value={maxEntriesPerFeed}
        min={50}
        max={5000}
        step={50}
        onChange={setMaxEntriesPerFeed}
      />

      <ToggleRow
        label="Keep Starred Articles"
        description="Starred articles are never deleted by cleanup"
        enabled={keepStarred}
        onChange={setKeepStarred}
      />

      <Separator />

      {/* ── Modules ─────────────────────────────────────────────── */}
      <SectionHeader title="Modules" description="Content source integrations" />

      {/* NRC Module */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <Newspaper size={14} className="text-blue-500" />
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">NRC Handelsblad</span>
              <p className="text-xs text-[var(--color-text-tertiary)]">Daily newspaper PDFs</p>
            </div>
          </div>
          <Toggle enabled={nrcEnabled} onChange={setNrcEnabled} />
        </div>

        {nrcEnabled && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] space-y-2.5">
            <input
              type="email"
              value={nrcEmail}
              onChange={(e) => setNrcEmail(e.target.value)}
              placeholder="Email"
              className={inputClass}
            />
            <div className="relative">
              <input
                type={showNrcPassword ? 'text' : 'password'}
                value={nrcPassword}
                onChange={(e) => setNrcPassword(e.target.value)}
                placeholder="Password"
                className={cn(inputClass, 'pr-9')}
              />
              <button
                type="button"
                onClick={() => setShowNrcPassword(!showNrcPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              >
                {showNrcPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-secondary)]">Issues to keep</span>
              <NumberInput value={nrcFeedDays} min={1} max={30} onChange={setNrcFeedDays} />
            </div>
            <ToggleRow label="Pre-cache PDFs" description="Download PDFs eagerly" enabled={nrcPreCachePdfs} onChange={setNrcPreCachePdfs} />
          </div>
        )}
      </Card>


      {/* MagazineLib Module */}      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center flex-shrink-0">
              <Library size={14} className="text-purple-500" />
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">MagazineLib</span>
              <p className="text-xs text-[var(--color-text-tertiary)]">Magazine PDF subscriptions</p>
            </div>
          </div>
          <Toggle enabled={magEnabled} onChange={setMagEnabled} />
        </div>

        {magEnabled && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--color-text-secondary)]">Issues per subscription</span>
              <NumberInput value={magMaxIssues} min={1} max={50} onChange={setMagMaxIssues} />
            </div>
            <ToggleRow label="Pre-cache PDFs" description="Download PDFs eagerly" enabled={magPreCachePdfs} onChange={setMagPreCachePdfs} />
          </div>
        )}
      </Card>

      {/* Books Module */}
      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <BookOpen size={14} className="text-emerald-500" />
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">Books</span>
              <p className="text-xs text-[var(--color-text-tertiary)]">EPUB library with reading progress</p>
            </div>
          </div>
          <Toggle enabled={booksEnabled} onChange={setBooksEnabled} />
        </div>

        {booksEnabled && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)] space-y-2.5">
            <ToggleRow label="Z-Library integration" description="Search and download EPUBs" enabled={booksZlibEnabled} onChange={setBooksZlibEnabled} />
            {booksZlibEnabled && (
              <div className="space-y-2.5 pl-1">
                <div>
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Mirror</label>
                  <select
                    value={zlibMirror}
                    onChange={(e) => setZlibMirror(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg text-sm bg-[var(--color-surface-inset)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
                  >
                    <option value="z-lib.fm">z-lib.fm</option>
                    <option value="z-lib.fo">z-lib.fo</option>
                    <option value="z-lib.gd">z-lib.gd</option>
                    <option value="z-lib.gl">z-lib.gl</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-[var(--color-text-secondary)]">Daily download limit</span>
                    <p className="text-xs text-[var(--color-text-tertiary)]">~5 anon, ~10 with account</p>
                  </div>
                  <NumberInput value={zlibDailyLimit} min={1} max={20} onChange={setZlibDailyLimit} />
                </div>
                <div className="pt-2 border-t border-[var(--color-border-subtle)]">
                  <label className="block text-xs text-[var(--color-text-secondary)] mb-1.5">
                    Z-Library Account <span className="text-[var(--color-text-tertiary)]">(optional)</span>
                  </label>
                  <div className="space-y-1.5">
                    <input
                      type="email"
                      placeholder="Email"
                      value={zlibEmail}
                      onChange={(e) => setZlibEmail(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      type="password"
                      placeholder="Password (leave empty to keep)"
                      value={zlibPassword}
                      onChange={(e) => setZlibPassword(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Save Button ────────────────────────────────────────── */}
      <div className="pt-1">
        <SaveButton saving={saving} success={saveSuccess} onClick={handleSave} label="Save Settings" />
      </div>
    </div>
  );
};

export default ContentSection;
