import { Check, Circle, ExternalLink, FileText, Headphones, Loader2, MessageSquare, MoreVertical, PanelRightClose, Share2, Star, Type, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entry } from '@/types/api';
import ContextMenu from '@frameer/components/ui/ContextMenu';
import type { ContextMenuItem } from '@frameer/components/ui/ContextMenu';

export type ArticleActionId =
  | 'listen'
  | 'reader-view'
  | 'typography'
  | 'comments'
  | 'bookmark'
  | 'read-status'
  | 'share'
  | 'open-original'
  | 'close';

interface ArticleActionDefinition {
  id: ArticleActionId;
  label: string;
  title: string;
  icon: (size: number) => React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  show?: boolean;
  divider?: boolean;
  tone?: 'default' | 'accent' | 'warning';
}

interface ArticleHeaderActionsProps {
  entry: Entry;
  isUnread: boolean;
  isReaderView: boolean;
  isLoadingReader: boolean;
  hasComments: boolean;
  showComments: boolean;
  showTypography: boolean;
  isTTSPlaying: boolean;
  onListenToArticle: () => void;
  onToggleReaderView: () => void;
  onToggleTypography: () => void;
  onToggleComments: () => void;
  onToggleBookmark: () => void;
  onToggleReadStatus: () => void;
  onShare: () => void;
  onClose: () => void;
  condensed?: boolean;
  alwaysVisibleIds?: readonly ArticleActionId[];
  overflowIds?: readonly ArticleActionId[];
}

export function getArticleActionDefinitions({
  entry,
  isUnread,
  isReaderView,
  isLoadingReader,
  hasComments,
  showComments,
  showTypography,
  isTTSPlaying,
  onListenToArticle,
  onToggleReaderView,
  onToggleTypography,
  onToggleComments,
  onToggleBookmark,
  onToggleReadStatus,
  onShare,
  onClose,
}: ArticleHeaderActionsProps): ArticleActionDefinition[] {
  // Reader view is only available for standard RSS feeds, not NRC, MagazineLib, YouTube, or podcasts
  const feedSourceType = entry.feed?.source_type || 'rss';
  const isYouTube = /youtube\.com|youtu\.be/.test(entry.url);
  const isAudio = !!entry.enclosures?.some(e => e.mime_type?.startsWith('audio/'));
  const isVideo = !!entry.enclosures?.some(e => e.mime_type?.startsWith('video/'));
  const canUseReaderView = feedSourceType === 'rss' && !isYouTube && !isAudio && !isVideo;
  return [
    {
      id: 'listen',
      label: isTTSPlaying ? 'Pause listening' : 'Listen to article',
      title: isTTSPlaying ? 'Pause listening' : 'Listen to article',
      icon: (size) => <Headphones size={size} />,
      onClick: onListenToArticle,
      active: isTTSPlaying,
      tone: 'accent',
    },
    {
      id: 'reader-view',
      label: isReaderView ? 'Show feed content' : 'Reader view',
      title: isReaderView ? 'Show feed content' : 'Reader view',
      icon: (size) => isLoadingReader ? <Loader2 size={size} className="animate-spin" /> : <FileText size={size} />,
      onClick: onToggleReaderView,
      disabled: isLoadingReader,
      active: isReaderView,
      tone: 'accent',
      show: canUseReaderView,
    },
    {
      id: 'typography',
      label: 'Typography',
      title: 'Typography settings',
      icon: (size) => <Type size={size} />,
      onClick: onToggleTypography,
      active: showTypography,
      tone: 'accent',
    },
    {
      id: 'comments',
      label: showComments ? 'Hide discussion' : 'Discussion',
      title: showComments ? 'Hide discussion' : 'Show discussion',
      icon: (size) => showComments ? <PanelRightClose size={size} /> : <MessageSquare size={size} />,
      onClick: onToggleComments,
      show: hasComments,
      active: showComments,
      tone: 'accent',
    },
    {
      id: 'bookmark',
      label: entry.starred ? 'Remove from starred' : 'Add to starred',
      title: entry.starred ? 'Remove from starred' : 'Add to starred',
      icon: (size) => <Star size={size} className={entry.starred ? 'fill-current' : ''} />,
      onClick: onToggleBookmark,
      active: entry.starred,
      tone: 'warning',
    },
    {
      id: 'read-status',
      label: isUnread ? 'Mark as read' : 'Mark as unread',
      title: isUnread ? 'Mark as read' : 'Mark as unread',
      icon: (size) => isUnread ? <Check size={size} /> : <Circle size={size} />,
      onClick: onToggleReadStatus,
      divider: true,
      tone: 'default',
    },
    {
      id: 'share',
      label: 'Share',
      title: 'Share',
      icon: (size) => <Share2 size={size} />,
      onClick: onShare,
      tone: 'default',
    },
    {
      id: 'open-original',
      label: 'Open original',
      title: 'Open original',
      icon: (size) => <ExternalLink size={size} />,
      onClick: () => window.open(entry.url, '_blank', 'noopener,noreferrer'),
      tone: 'default',
    },
    {
      id: 'close',
      label: 'Close',
      title: 'Close (Escape)',
      icon: (size) => <X size={size} />,
      onClick: onClose,
      tone: 'default',
    },
  ];
}

export function getArticleContextMenuItems(
  definitions: ArticleActionDefinition[],
  includeIds: ArticleActionId[]
): ContextMenuItem[] {
  return includeIds
    .map((id) => definitions.find((definition) => definition.id === id))
    .filter((definition): definition is ArticleActionDefinition => !!definition && definition.show !== false)
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      icon: definition.icon(16),
      onClick: definition.onClick,
      disabled: definition.disabled,
      divider: definition.divider,
    }));
}

export function ArticleHeaderActions({
  entry,
  isUnread,
  isReaderView,
  isLoadingReader,
  hasComments,
  showComments,
  showTypography,
  isTTSPlaying,
  onListenToArticle,
  onToggleReaderView,
  onToggleTypography,
  onToggleComments,
  onToggleBookmark,
  onToggleReadStatus,
  onShare,
  onClose,
  condensed = false,
  alwaysVisibleIds = [],
  overflowIds = [],
}: ArticleHeaderActionsProps) {
  const btnClass = 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-white/10 dark:hover:bg-white/10 transition-colors';
  const definitions = getArticleActionDefinitions({
    entry,
    isUnread,
    isReaderView,
    isLoadingReader,
    hasComments,
    showComments,
    showTypography,
    isTTSPlaying,
    onListenToArticle,
    onToggleReaderView,
    onToggleTypography,
    onToggleComments,
    onToggleBookmark,
    onToggleReadStatus,
    onShare,
    onClose,
  }).filter((definition) => definition.show !== false);

  const orderedDefinitions = definitions;
  const visibleDefinitions = condensed
    ? orderedDefinitions.filter((definition) => alwaysVisibleIds.includes(definition.id))
    : orderedDefinitions;
  const menuDefinitions = condensed
    ? orderedDefinitions.filter((definition) => overflowIds.includes(definition.id))
    : [];
  const menuItems: ContextMenuItem[] = menuDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    icon: definition.icon(16),
    onClick: definition.onClick,
    disabled: definition.disabled,
    divider: definition.divider,
  }));

  const toneClass = (definition: ArticleActionDefinition) => {
    if (definition.tone === 'warning' && definition.active) {
      return 'text-amber-500 bg-amber-500/10 hover:bg-amber-500/20';
    }

    if (definition.tone === 'accent' && definition.active) {
      return 'text-[var(--color-accent-primary)] bg-[var(--color-accent-muted)]';
    }

    return '';
  };

  return (
    <div className="glass-panel-nav flex flex-shrink-0 items-center gap-0.5 overflow-hidden px-1.5 py-1 whitespace-nowrap">
      {visibleDefinitions.map((definition) => (
        <button
          key={definition.id}
          onClick={definition.onClick}
          disabled={definition.disabled}
          className={cn(btnClass, toneClass(definition))}
          title={definition.title}
        >
          {definition.icon(18)}
        </button>
      ))}

      {menuItems.length > 0 && (
        <ContextMenu items={menuItems} trigger="click">
          <button
            className={btnClass}
            title="More actions"
            aria-label="More actions"
          >
            <MoreVertical size={18} />
          </button>
        </ContextMenu>
      )}
    </div>
  );
}
