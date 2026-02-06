/**
 * CommentsPanel
 * Displays comments from Hacker News or Reddit
 */
import { useState, useEffect, useMemo } from 'react';
import {
  HNComment,
  RedditComment,
  fetchHNComments,
  fetchRedditComments,
  extractHNItemIdFromCommentsUrl,
  extractRedditInfo,
  isHackerNewsUrl,
  isRedditUrl,
} from '../../api/comments';
import { Entry } from '../../types/miniflux';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, ChevronRight, ChevronDown, MessageSquare, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CommentsPanelProps {
  entry: Entry;
  className?: string;
}

type CommentSource = 'hn' | 'reddit' | null;

export function CommentsPanel({ entry, className }: CommentsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hnComments, setHnComments] = useState<HNComment[]>([]);
  const [redditComments, setRedditComments] = useState<RedditComment[]>([]);
  const [storyTitle, setStoryTitle] = useState<string>('');
  const [commentCount, setCommentCount] = useState<number>(0);
  const [source, setSource] = useState<CommentSource>(null);

  // Determine the comment source based on the entry
  const commentSource = useMemo((): { type: CommentSource; data: any } => {
    // First check comments_url (from RSS feeds like hnrss.org)
    if (entry.comments_url) {
      if (isHackerNewsUrl(entry.comments_url)) {
        const itemId = extractHNItemIdFromCommentsUrl(entry.comments_url);
        if (itemId) return { type: 'hn', data: { itemId } };
      }
      if (isRedditUrl(entry.comments_url)) {
        const info = extractRedditInfo(entry.comments_url);
        if (info) return { type: 'reddit', data: info };
      }
    }
    
    // Also check the article URL itself (in case it's linking to HN or Reddit directly)
    if (entry.url) {
      if (isRedditUrl(entry.url)) {
        const info = extractRedditInfo(entry.url);
        if (info) return { type: 'reddit', data: info };
      }
    }
    
    return { type: null, data: null };
  }, [entry.comments_url, entry.url]);

  useEffect(() => {
    const loadComments = async () => {
      if (!commentSource.type) return;

      setLoading(true);
      setError(null);

      try {
        if (commentSource.type === 'hn' && commentSource.data.itemId) {
          const { story, comments } = await fetchHNComments(commentSource.data.itemId);
          setHnComments(comments);
          setStoryTitle(story?.title || '');
          setCommentCount(story?.descendants || comments.length);
          setSource('hn');
        } else if (commentSource.type === 'reddit' && commentSource.data) {
          const { subreddit, postId } = commentSource.data;
          const { post, comments } = await fetchRedditComments(subreddit, postId);
          setRedditComments(comments);
          setStoryTitle(post?.title || '');
          setCommentCount(post?.num_comments || comments.length);
          setSource('reddit');
        }
      } catch (err) {
        setError('Failed to load comments');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadComments();
  }, [commentSource]);

  if (!commentSource.type) {
    return (
      <div className={cn("bg-[var(--color-surface-base)] p-6 text-center", className)}>
        <p className="text-[var(--color-text-tertiary)]">No discussion available for this article</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("bg-[var(--color-surface-base)] p-6 flex items-center justify-center min-h-[200px]", className)}>
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent-fg)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("bg-[var(--color-surface-base)] p-6 text-center", className)}>
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn("bg-[var(--color-surface-base)] flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <div className="px-4 py-3 pt-12 md:pt-14 border-b border-[var(--color-border-subtle)] flex items-center gap-2 flex-shrink-0">
        {source === 'hn' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-500/10 text-orange-500 text-xs font-medium">
            <MessageSquare size={12} />
            Hacker News
          </span>
        )}
        {source === 'reddit' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-orange-500/10 text-orange-500 text-xs font-medium">
            <MessageCircle size={12} />
            Reddit
          </span>
        )}
        <span className="text-sm text-[var(--color-text-tertiary)]">{commentCount} comments</span>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {source === 'hn' && hnComments.map(comment => (
            <CommentItem key={comment.id} comment={comment} source="hn" />
          ))}
          {source === 'reddit' && redditComments.map(comment => (
            <CommentItem key={comment.id} comment={comment} source="reddit" />
          ))}
          
          {((source === 'hn' && !hnComments.length) || (source === 'reddit' && !redditComments.length)) && (
            <p className="text-[var(--color-text-tertiary)] text-center py-6">No comments yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Decode HTML entities from Reddit */
const decodeHtml = (html: string) => {
  if (!html) return '';
  const el = document.createElement('textarea');
  el.innerHTML = html;
  return el.value;
};

/** Unified comment item for HN and Reddit */
function CommentItem({ comment, source }: { 
  comment: HNComment | RedditComment; 
  source: 'hn' | 'reddit';
}) {
  const [collapsed, setCollapsed] = useState(false);
  
  const isHN = source === 'hn';
  const hn = isHN ? comment as HNComment : null;
  const reddit = !isHN ? comment as RedditComment : null;
  
  const author = hn?.by || reddit?.author || '[deleted]';
  const timestamp = (hn?.time || reddit?.created_utc || 0) * 1000;
  const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true });
  const html = isHN ? hn!.text : decodeHtml(reddit!.body_html);
  const children = hn?.children || reddit?.replies || [];
  const depth = hn?.depth ?? reddit?.depth ?? 0;
  
  // Author styling
  const authorClass = cn("text-xs font-medium", 
    reddit?.is_submitter ? "text-blue-500" 
    : reddit?.distinguished === 'moderator' ? "text-green-500" 
    : "text-orange-500"
  );
  
  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 12 }}>
      <div className="flex items-center gap-2 mb-1 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? <ChevronRight size={14} className="text-[var(--color-text-tertiary)]" /> 
                   : <ChevronDown size={14} className="text-[var(--color-text-tertiary)]" />}
        <span className={authorClass}>
          {author}
          {reddit?.is_submitter && ' (OP)'}
          {reddit?.distinguished === 'moderator' && ' [MOD]'}
        </span>
        {reddit && <span className="text-xs text-[var(--color-text-tertiary)]">{reddit.score} pts •</span>}
        <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo}</span>
      </div>
      {!collapsed && (
        <>
          <div className="pl-5 text-sm leading-relaxed text-[var(--color-text-primary)] [&_a]:text-[var(--color-accent-fg)] [&_a]:underline [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:bg-[var(--color-surface-inset)] [&_pre]:p-2 [&_pre]:rounded [&_code]:text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {children.length > 0 && (
            <div className="mt-2">
              {children.map((child: HNComment | RedditComment) => (
                <CommentItem key={child.id} comment={child} source={source} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CommentsPanel;
