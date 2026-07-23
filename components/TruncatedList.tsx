// components/TruncatedList.tsx
//
// Server-safe list truncation: renders the first `limit` items, tucking the
// rest inside a native <details> disclosure ("Show all N"). No client JS.
// Added when the tracker import put 380+ rows in the dashboard Archive.

export default function TruncatedList({
  items,
  limit = 10,
  className = "doc-list",
  moreLabel = "Show all",
}: {
  items: React.ReactNode[];
  limit?: number;
  className?: string;
  moreLabel?: string;
}) {
  if (items.length <= limit) {
    return <ul className={className}>{items}</ul>;
  }
  return (
    <>
      <ul className={className}>{items.slice(0, limit)}</ul>
      <details className="show-more">
        <summary>
          {moreLabel} {items.length} ({items.length - limit} more)
        </summary>
        <ul className={className}>{items.slice(limit)}</ul>
      </details>
    </>
  );
}
