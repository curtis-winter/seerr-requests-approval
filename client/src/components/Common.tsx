import React from 'react';

interface StatusChipProps {
  status: number;
}

export function StatusChip({ status }: StatusChipProps) {
  const statusMap: Record<number, { label: string; variant: string }> = {
    1: { label: 'Pending', variant: 'badge-pending' },
    2: { label: 'Approved', variant: 'badge-approved' },
    3: { label: 'Declined', variant: 'badge-declined' },
  };
  const info = statusMap[status] || { label: 'Unknown', variant: 'badge-unknown' };
  return <span className={`badge ${info.variant}`}>{info.label}</span>;
}

interface MediaTypeChipProps {
  mediaType: string;
}

export function MediaTypeChip({ mediaType }: MediaTypeChipProps) {
  const label =
    mediaType === 'movie' ? 'Movie' : mediaType === 'tv' ? 'TV' : 'All';
  return (
    <span
      className="badge badge-unknown"
      style={{ textTransform: 'none', fontWeight: 600 }}
    >
      {label}
    </span>
  );
}

interface SynopsisProps {
  text: string | null;
  expanded?: boolean;
  onToggle?: () => void;
}

export function Synopsis({ text, expanded = false, onToggle }: SynopsisProps) {
  if (!text) return null;
  const cls = ['synopsis', expanded ? 'expanded' : 'expandable'].join(' ');
  return (
    <p className={cls} onClick={onToggle} role="button" tabIndex={0}>
      {text}
    </p>
  );
}
