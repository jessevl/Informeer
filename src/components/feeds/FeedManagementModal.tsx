/**
 * FeedManagementModal Component
 * Comprehensive feed and category management with a delightful modern UI
 * Features: Category CRUD, Feed move/edit/delete, OPML import/export, batch operations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import {
  X,
  Plus,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  Edit3,
  Check,
  Search,
  Upload,
  Download,
  RefreshCw,
  AlertCircle,
  Rss,
  GripVertical,
  FolderPlus,
  ArrowRight,
  ExternalLink,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { FeedIcon } from './FeedIcon';
import { miniflux } from '@/api/miniflux';
import { useFeedsStore } from '@/stores/feeds';
import type { Feed, Category } from '@/types/miniflux';

interface FeedManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  feeds: Feed[];
  categories: Category[];
}

type Tab = 'feeds' | 'categories' | 'import-export';

export function FeedManagementModal({ isOpen, onClose, feeds, categories }: FeedManagementModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('feeds');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set(categories.map(c => c.id))
  );
  const [selectedFeeds, setSelectedFeeds] = useState<Set<number>>(new Set());
  const [isMoving, setIsMoving] = useState(false);
  const [moveTargetCategory, setMoveTargetCategory] = useState<number | null>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  
  // Drag and drop state
  const [draggingFeed, setDraggingFeed] = useState<Feed | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<number | null>(null);
  
  // Category management
  const [editingCategory, setEditingCategory] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  // Feed management
  const [editingFeed, setEditingFeed] = useState<number | null>(null);
  const [editingFeedName, setEditingFeedName] = useState('');
  
  // OPML
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  
  // Loading states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const {
    createCategory,
    updateCategory,
    deleteCategory,
    updateFeed,
    deleteFeed,
    fetchFeeds,
    fetchCategories,
    refreshFeed,
  } = useFeedsStore();

  // Group feeds by category
  const feedsByCategory = categories.map(cat => ({
    ...cat,
    feeds: feeds.filter(f => f.category?.id === cat.id),
  }));
  
  // Uncategorized feeds
  const uncategorizedFeeds = feeds.filter(f => !f.category);

  // Filter feeds by search
  const filteredFeedsByCategory = feedsByCategory.map(cat => ({
    ...cat,
    feeds: cat.feeds.filter(f => 
      f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.feed_url.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(cat => cat.feeds.length > 0 || searchQuery === '');

  const filteredUncategorized = uncategorizedFeeds.filter(f =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.feed_url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedFeeds(new Set());
      setSearchQuery('');
      setEditingCategory(null);
      setEditingFeed(null);
      setIsCreatingCategory(false);
      setImportError(null);
      setImportSuccess(false);
    }
  }, [isOpen]);

  // Toggle category expansion
  const toggleCategory = (categoryId: number) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Toggle feed selection
  const toggleFeedSelection = (feedId: number) => {
    setSelectedFeeds(prev => {
      const next = new Set(prev);
      if (next.has(feedId)) {
        next.delete(feedId);
      } else {
        next.add(feedId);
      }
      return next;
    });
  };

  // Select all feeds in a category
  const selectAllInCategory = (categoryId: number) => {
    const categoryFeeds = feeds.filter(f => f.category?.id === categoryId);
    const allSelected = categoryFeeds.every(f => selectedFeeds.has(f.id));
    
    setSelectedFeeds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        categoryFeeds.forEach(f => next.delete(f.id));
      } else {
        categoryFeeds.forEach(f => next.add(f.id));
      }
      return next;
    });
  };

  // Handle category rename
  const handleCategoryRename = async (categoryId: number) => {
    if (!editingCategoryName.trim()) return;
    
    setActionLoading(`category-${categoryId}`);
    try {
      await updateCategory(categoryId, { title: editingCategoryName.trim() });
      setEditingCategory(null);
    } catch (error) {
      console.error('Failed to rename category:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle category hide_globally toggle
  const handleToggleCategoryHideGlobally = async (categoryId: number, currentValue: boolean) => {
    setActionLoading(`category-hide-${categoryId}`);
    try {
      await updateCategory(categoryId, { hide_globally: !currentValue });
    } catch (error) {
      console.error('Failed to toggle category visibility:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle category creation
  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    
    setActionLoading('create-category');
    try {
      await createCategory(newCategoryName.trim());
      setNewCategoryName('');
      setIsCreatingCategory(false);
    } catch (error) {
      console.error('Failed to create category:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle category deletion
  const handleDeleteCategory = async (categoryId: number, categoryTitle: string) => {
    const categoryFeedCount = feeds.filter(f => f.category?.id === categoryId).length;
    const confirmMsg = categoryFeedCount > 0
      ? `Delete "${categoryTitle}" and its ${categoryFeedCount} feed${categoryFeedCount > 1 ? 's' : ''}? This cannot be undone.`
      : `Delete "${categoryTitle}"? This cannot be undone.`;
    
    if (!confirm(confirmMsg)) return;
    
    setActionLoading(`category-${categoryId}`);
    try {
      await deleteCategory(categoryId);
    } catch (error) {
      console.error('Failed to delete category:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle feed rename
  const handleFeedRename = async (feedId: number) => {
    if (!editingFeedName.trim()) return;
    
    setActionLoading(`feed-${feedId}`);
    try {
      await updateFeed(feedId, { title: editingFeedName.trim() });
      setEditingFeed(null);
    } catch (error) {
      console.error('Failed to rename feed:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle feed deletion
  const handleDeleteFeed = async (feed: Feed) => {
    if (!confirm(`Delete "${feed.title}"? This cannot be undone.`)) return;
    
    setActionLoading(`feed-${feed.id}`);
    try {
      await deleteFeed(feed.id);
      setSelectedFeeds(prev => {
        const next = new Set(prev);
        next.delete(feed.id);
        return next;
      });
    } catch (error) {
      console.error('Failed to delete feed:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle move feeds to category
  const handleMoveFeeds = async (targetCategoryId: number) => {
    if (selectedFeeds.size === 0) return;
    
    setIsMoving(true);
    try {
      // API expects category_id, not a full category object
      const promises = Array.from(selectedFeeds).map(feedId =>
        updateFeed(feedId, { category_id: targetCategoryId } as any)
      );
      await Promise.all(promises);
      setSelectedFeeds(new Set());
      setShowMoveMenu(false);
    } catch (error) {
      console.error('Failed to move feeds:', error);
    } finally {
      setIsMoving(false);
    }
  };

  // Drag and drop handlers for moving feeds between categories
  const handleDragStart = (e: React.DragEvent, feed: Feed) => {
    setDraggingFeed(feed);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', feed.id.toString());
    // Add drag image styling
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggingFeed(null);
    setDragOverCategory(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent, categoryId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCategory(categoryId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're actually leaving the category area
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragOverCategory(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetCategoryId: number) => {
    e.preventDefault();
    setDragOverCategory(null);
    
    if (!draggingFeed) return;
    
    // Don't do anything if dropping on the same category
    if (draggingFeed.category?.id === targetCategoryId) {
      setDraggingFeed(null);
      return;
    }
    
    setActionLoading(`feed-${draggingFeed.id}`);
    try {
      await updateFeed(draggingFeed.id, { category_id: targetCategoryId } as any);
    } catch (error) {
      console.error('Failed to move feed:', error);
    } finally {
      setActionLoading(null);
      setDraggingFeed(null);
    }
  };

  // Handle batch delete
  const handleBatchDelete = async () => {
    if (selectedFeeds.size === 0) return;
    
    if (!confirm(`Delete ${selectedFeeds.size} selected feed${selectedFeeds.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    
    setActionLoading('batch-delete');
    try {
      const promises = Array.from(selectedFeeds).map(feedId => deleteFeed(feedId));
      await Promise.all(promises);
      setSelectedFeeds(new Set());
    } catch (error) {
      console.error('Failed to delete feeds:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // OPML Export
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const opml = await miniflux.exportOPML();
      const blob = new Blob([opml], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `informeer-feeds-${new Date().toISOString().split('T')[0]}.opml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export OPML:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // OPML Import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(false);
    
    try {
      const content = await file.text();
      await miniflux.importOPML(content);
      await fetchFeeds();
      await fetchCategories();
      setImportSuccess(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to import OPML');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-backdrop-in"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-3xl bg-[var(--color-surface-base)] rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Manage Feeds</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X size={18} className="text-[var(--color-text-secondary)]" />
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border-subtle)]">
          {[
            { id: 'feeds' as Tab, label: 'Feeds', count: feeds.length },
            { id: 'categories' as Tab, label: 'Categories', count: categories.length },
            { id: 'import-export' as Tab, label: 'Import / Export' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2',
                activeTab === tab.id
                  ? 'text-[var(--color-accent-fg)] border-b-2 border-[var(--color-accent-fg)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  activeTab === tab.id
                    ? 'bg-[var(--color-accent-fg)]/10'
                    : 'bg-[var(--color-surface-inset)]'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Feeds Tab */}
          {activeTab === 'feeds' && (
            <>
              {/* Search & Actions Bar */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)]/50">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search feeds..."
                    className={cn(
                      'w-full pl-9 pr-4 py-2 rounded-lg border text-sm',
                      'bg-[var(--color-surface-inset)] border-[var(--color-border-subtle)]',
                      'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                      'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)] focus:border-transparent'
                    )}
                  />
                </div>
                
                {/* Batch Actions */}
                {selectedFeeds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {selectedFeeds.size} selected
                    </span>
                    
                    {/* Move Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setShowMoveMenu(!showMoveMenu)}
                        disabled={isMoving}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                          'bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]',
                          'hover:bg-[var(--color-surface-hover)] border border-[var(--color-border-subtle)]'
                        )}
                      >
                        {isMoving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                        Move
                        <ChevronDown size={14} />
                      </button>
                      
                      {showMoveMenu && (
                        <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)] rounded-lg shadow-lg z-10 py-1 max-h-64 overflow-y-auto">
                          {categories.map(cat => (
                            <button
                              key={cat.id}
                              onClick={() => handleMoveFeeds(cat.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-surface-hover)] transition-colors"
                            >
                              <FolderOpen size={14} className="text-[var(--color-text-tertiary)]" />
                              <span className="truncate">{cat.title}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button
                      onClick={handleBatchDelete}
                      disabled={actionLoading === 'batch-delete'}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                      )}
                    >
                      {actionLoading === 'batch-delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Delete
                    </button>
                  </div>
                )}
              </div>
              
              {/* Feeds List */}
              <div className="flex-1 overflow-y-auto">
                {filteredFeedsByCategory.length === 0 && filteredUncategorized.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-[var(--color-text-tertiary)]">
                    <Rss size={48} strokeWidth={1} />
                    <p className="mt-4 text-sm">
                      {searchQuery ? 'No feeds match your search' : 'No feeds yet'}
                    </p>
                  </div>
                ) : (
                  <div className="py-2">
                    {/* Categorized Feeds */}
                    {filteredFeedsByCategory.map(cat => (
                      <CategoryFeedGroup
                        key={cat.id}
                        category={cat}
                        feeds={cat.feeds}
                        expanded={expandedCategories.has(cat.id)}
                        onToggle={() => toggleCategory(cat.id)}
                        selectedFeeds={selectedFeeds}
                        onToggleFeedSelection={toggleFeedSelection}
                        onSelectAll={() => selectAllInCategory(cat.id)}
                        editingFeed={editingFeed}
                        editingFeedName={editingFeedName}
                        setEditingFeed={setEditingFeed}
                        setEditingFeedName={setEditingFeedName}
                        onFeedRename={handleFeedRename}
                        onDeleteFeed={handleDeleteFeed}
                        actionLoading={actionLoading}
                        // Drag and drop
                        isDragOver={dragOverCategory === cat.id}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, cat.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, cat.id)}
                      />
                    ))}
                    
                    {/* Uncategorized */}
                    {filteredUncategorized.length > 0 && (
                      <CategoryFeedGroup
                        category={{ id: 0, title: 'Uncategorized', user_id: 0, hide_globally: false }}
                        feeds={filteredUncategorized}
                        expanded={expandedCategories.has(0)}
                        onToggle={() => toggleCategory(0)}
                        selectedFeeds={selectedFeeds}
                        onToggleFeedSelection={toggleFeedSelection}
                        onSelectAll={() => {
                          const allSelected = filteredUncategorized.every(f => selectedFeeds.has(f.id));
                          setSelectedFeeds(prev => {
                            const next = new Set(prev);
                            if (allSelected) {
                              filteredUncategorized.forEach(f => next.delete(f.id));
                            } else {
                              filteredUncategorized.forEach(f => next.add(f.id));
                            }
                            return next;
                          });
                        }}
                        editingFeed={editingFeed}
                        editingFeedName={editingFeedName}
                        setEditingFeed={setEditingFeed}
                        setEditingFeedName={setEditingFeedName}
                        onFeedRename={handleFeedRename}
                        onDeleteFeed={handleDeleteFeed}
                        actionLoading={actionLoading}
                        // Drag and drop
                        isDragOver={dragOverCategory === 0}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, 0)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, 0)}
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Categories Tab */}
          {activeTab === 'categories' && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-2">
                {categories.map(cat => {
                  const feedCount = feeds.filter(f => f.category?.id === cat.id).length;
                  const isEditing = editingCategory === cat.id;
                  const isLoading = actionLoading === `category-${cat.id}`;
                  
                  return (
                    <div
                      key={cat.id}
                      className={cn(
                        'group flex items-center gap-3 px-4 py-3 rounded-xl transition-colors',
                        'bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)]',
                        'border border-[var(--color-border-subtle)]'
                      )}
                    >
                      <FolderOpen size={20} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
                      
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCategoryRename(cat.id);
                            if (e.key === 'Escape') setEditingCategory(null);
                          }}
                          autoFocus
                          className={cn(
                            'flex-1 px-2 py-1 rounded text-sm',
                            'bg-[var(--color-surface-inset)] border border-[var(--color-border-default)]',
                            'text-[var(--color-text-primary)]',
                            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)]'
                          )}
                        />
                      ) : (
                        <span className="flex-1 text-sm font-medium text-[var(--color-text-primary)]">
                          {cat.title}
                        </span>
                      )}
                      
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {feedCount} feed{feedCount !== 1 ? 's' : ''}
                      </span>
                      
                      {/* Hide Globally Toggle */}
                      <button
                        onClick={() => handleToggleCategoryHideGlobally(cat.id, cat.hide_globally)}
                        disabled={actionLoading === `category-hide-${cat.id}`}
                        className={cn(
                          'p-1.5 rounded-full transition-colors',
                          cat.hide_globally
                            ? 'bg-amber-500/20 text-amber-500'
                            : 'hover:bg-[var(--color-surface-inset)] text-[var(--color-text-tertiary)]'
                        )}
                        title={cat.hide_globally ? 'Hidden from global list - click to show' : 'Hide from global list'}
                      >
                        {actionLoading === `category-hide-${cat.id}` ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : cat.hide_globally ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                      
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => handleCategoryRename(cat.id)}
                              disabled={isLoading}
                              className="p-1.5 rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                            >
                              {isLoading ? (
                                <Loader2 size={14} className="animate-spin text-[var(--color-text-secondary)]" />
                              ) : (
                                <Check size={14} className="text-green-500" />
                              )}
                            </button>
                            <button
                              onClick={() => setEditingCategory(null)}
                              className="p-1.5 rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                            >
                              <X size={14} className="text-[var(--color-text-secondary)]" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingCategory(cat.id);
                                setEditingCategoryName(cat.title);
                              }}
                              className="p-1.5 rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                              title="Rename"
                            >
                              <Edit3 size={14} className="text-[var(--color-text-secondary)]" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat.id, cat.title)}
                              disabled={isLoading}
                              className="p-1.5 rounded-full hover:bg-red-500/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {/* Create New Category */}
                {isCreatingCategory ? (
                  <div className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl',
                    'bg-[var(--color-surface-secondary)]',
                    'border border-[var(--color-accent-fg)] border-dashed'
                  )}>
                    <FolderPlus size={20} className="text-[var(--color-accent-fg)] flex-shrink-0" />
                    <input
                      type="text"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateCategory();
                        if (e.key === 'Escape') {
                          setIsCreatingCategory(false);
                          setNewCategoryName('');
                        }
                      }}
                      placeholder="Category name..."
                      autoFocus
                      className={cn(
                        'flex-1 px-2 py-1 rounded text-sm',
                        'bg-[var(--color-surface-inset)] border border-[var(--color-border-default)]',
                        'text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]',
                        'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)]'
                      )}
                    />
                    <button
                      onClick={handleCreateCategory}
                      disabled={actionLoading === 'create-category' || !newCategoryName.trim()}
                      className="p-1.5 rounded-full hover:bg-[var(--color-surface-inset)] transition-colors disabled:opacity-50"
                    >
                      {actionLoading === 'create-category' ? (
                        <Loader2 size={14} className="animate-spin text-[var(--color-text-secondary)]" />
                      ) : (
                        <Check size={14} className="text-green-500" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setIsCreatingCategory(false);
                        setNewCategoryName('');
                      }}
                      className="p-1.5 rounded-full hover:bg-[var(--color-surface-inset)] transition-colors"
                    >
                      <X size={14} className="text-[var(--color-text-secondary)]" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreatingCategory(true)}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl transition-colors',
                      'border border-dashed border-[var(--color-border-default)]',
                      'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                      'hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-accent-fg)]'
                    )}
                  >
                    <Plus size={16} />
                    <span className="text-sm font-medium">Add Category</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Import/Export Tab */}
          {activeTab === 'import-export' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-6">
                {/* Export Section */}
                <div className="p-5 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)]">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-accent-fg)]/10 flex items-center justify-center flex-shrink-0">
                      <Download size={20} className="text-[var(--color-accent-fg)]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                        Export Feeds
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                        Download all your feeds and categories as an OPML file. Use this for backup or to import into other RSS readers.
                      </p>
                      <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className={cn(
                          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          'bg-[var(--color-accent-fg)] text-white',
                          'hover:opacity-90 disabled:opacity-50'
                        )}
                      >
                        {isExporting ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Download size={16} />
                        )}
                        {isExporting ? 'Exporting...' : 'Export OPML'}
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Import Section */}
                <div className="p-5 rounded-xl bg-[var(--color-surface-secondary)] border border-[var(--color-border-subtle)]">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                      <Upload size={20} className="text-green-500" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">
                        Import Feeds
                      </h3>
                      <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                        Import feeds from an OPML file. This will add new feeds and categories without removing existing ones.
                      </p>
                      
                      {importError && (
                        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
                          <AlertCircle size={16} />
                          {importError}
                        </div>
                      )}
                      
                      {importSuccess && (
                        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-500/10 text-green-500 text-sm">
                          <Check size={16} />
                          Feeds imported successfully!
                        </div>
                      )}
                      
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".opml,.xml"
                        onChange={handleImport}
                        className="hidden"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                        className={cn(
                          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                          'bg-green-500 text-white',
                          'hover:opacity-90 disabled:opacity-50'
                        )}
                      >
                        {isImporting ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Upload size={16} />
                        )}
                        {isImporting ? 'Importing...' : 'Choose OPML File'}
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Info */}
                <div className="text-xs text-[var(--color-text-tertiary)] text-center">
                  OPML (Outline Processor Markup Language) is a standard format for exchanging RSS subscriptions between apps.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Category Feed Group Component
function CategoryFeedGroup({
  category,
  feeds,
  expanded,
  onToggle,
  selectedFeeds,
  onToggleFeedSelection,
  onSelectAll,
  editingFeed,
  editingFeedName,
  setEditingFeed,
  setEditingFeedName,
  onFeedRename,
  onDeleteFeed,
  actionLoading,
  // Drag and drop props
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  category: Category;
  feeds: Feed[];
  expanded: boolean;
  onToggle: () => void;
  selectedFeeds: Set<number>;
  onToggleFeedSelection: (feedId: number) => void;
  onSelectAll: () => void;
  editingFeed: number | null;
  editingFeedName: string;
  setEditingFeed: (id: number | null) => void;
  setEditingFeedName: (name: string) => void;
  onFeedRename: (feedId: number) => void;
  onDeleteFeed: (feed: Feed) => void;
  actionLoading: string | null;
  // Drag and drop
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent, feed: Feed) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const allSelected = feeds.length > 0 && feeds.every(f => selectedFeeds.has(f.id));
  const someSelected = feeds.some(f => selectedFeeds.has(f.id));
  
  return (
    <div 
      className={cn(
        'px-2 rounded-lg transition-all',
        isDragOver && 'bg-[var(--color-accent-fg)]/10 ring-2 ring-[var(--color-accent-fg)] ring-inset'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Category Header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
          'hover:bg-[var(--color-surface-hover)] text-left'
        )}
      >
        <span className="text-[var(--color-text-tertiary)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <FolderOpen size={16} className={cn(
          'text-[var(--color-text-tertiary)]',
          isDragOver && 'text-[var(--color-accent-fg)]'
        )} />
        <span className={cn(
          'flex-1 text-sm font-medium',
          isDragOver ? 'text-[var(--color-accent-fg)]' : 'text-[var(--color-text-primary)]'
        )}>
          {category.title}
          {isDragOver && <span className="ml-2 text-xs">(Drop here)</span>}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {feeds.length}
        </span>
        {feeds.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectAll();
            }}
            className={cn(
              'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
              allSelected
                ? 'bg-[var(--color-accent-fg)] border-[var(--color-accent-fg)]'
                : someSelected
                ? 'bg-[var(--color-accent-fg)]/30 border-[var(--color-accent-fg)]'
                : 'border-[var(--color-border-default)] hover:border-[var(--color-accent-fg)]'
            )}
          >
            {(allSelected || someSelected) && (
              <Check size={12} className="text-white" />
            )}
          </button>
        )}
      </button>
      
      {/* Feeds */}
      {expanded && feeds.length > 0 && (
        <div className="ml-7 space-y-0.5 mt-0.5">
          {feeds.map(feed => {
            const isEditing = editingFeed === feed.id;
            const isLoading = actionLoading === `feed-${feed.id}`;
            const isSelected = selectedFeeds.has(feed.id);
            
            return (
              <div
                key={feed.id}
                draggable={!isEditing}
                onDragStart={(e) => onDragStart?.(e, feed)}
                onDragEnd={onDragEnd}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-grab active:cursor-grabbing',
                  isSelected
                    ? 'bg-[var(--color-accent-fg)]/10'
                    : 'hover:bg-[var(--color-surface-hover)]'
                )}
              >
                {/* Drag handle */}
                <span className="text-[var(--color-text-disabled)] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                  <GripVertical size={14} />
                </span>
                
                {/* Selection checkbox */}
                <button
                  onClick={() => onToggleFeedSelection(feed.id)}
                  className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0',
                    isSelected
                      ? 'bg-[var(--color-accent-fg)] border-[var(--color-accent-fg)]'
                      : 'border-[var(--color-border-default)] hover:border-[var(--color-accent-fg)]'
                  )}
                >
                  {isSelected && <Check size={12} className="text-white" />}
                </button>
                
                {/* Feed icon */}
                <FeedIcon feedId={feed.id} iconId={feed.icon?.icon_id} size={16} />
                
                {/* Feed title */}
                {isEditing ? (
                  <input
                    type="text"
                    value={editingFeedName}
                    onChange={(e) => setEditingFeedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onFeedRename(feed.id);
                      if (e.key === 'Escape') setEditingFeed(null);
                    }}
                    autoFocus
                    className={cn(
                      'flex-1 px-2 py-0.5 rounded text-sm',
                      'bg-[var(--color-surface-inset)] border border-[var(--color-border-default)]',
                      'text-[var(--color-text-primary)]',
                      'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-fg)]'
                    )}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate">
                    {feed.title}
                  </span>
                )}
                
                {/* Error indicator */}
                {feed.parsing_error_count > 0 && !isEditing && (
                  <span title={feed.parsing_error_message} className="text-red-500">
                    <AlertCircle size={14} />
                  </span>
                )}
                
                {/* Actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isEditing ? (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onFeedRename(feed.id);
                        }}
                        disabled={isLoading}
                        className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                      >
                        {isLoading ? (
                          <Loader2 size={14} className="animate-spin text-[var(--color-text-secondary)]" />
                        ) : (
                          <Check size={14} className="text-green-500" />
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingFeed(null);
                        }}
                        className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                      >
                        <X size={14} className="text-[var(--color-text-secondary)]" />
                      </button>
                    </>
                  ) : (
                    <>
                      <a
                        href={feed.site_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                        title="Visit site"
                      >
                        <ExternalLink size={14} className="text-[var(--color-text-tertiary)]" />
                      </a>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingFeed(feed.id);
                          setEditingFeedName(feed.title);
                        }}
                        className="p-1 rounded hover:bg-[var(--color-surface-inset)] transition-colors"
                        title="Rename"
                      >
                        <Edit3 size={14} className="text-[var(--color-text-secondary)]" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFeed(feed);
                        }}
                        disabled={isLoading}
                        className="p-1 rounded hover:bg-red-500/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FeedManagementModal;
