import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../store/useSessionStore';
import { REMOTE_NOTICE_MS } from '../lib/constants';

export function RemoteNotice() {
  const notice = useSessionStore((s) => s.remoteNotice);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setVisible(false), REMOTE_NOTICE_MS);
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, [notice]);

  return (
    <span
      id="remote-notice"
      className={`remote-notice${visible ? ' show' : ''}`}
      aria-live="polite"
    >
      {notice?.text ?? ''}
    </span>
  );
}
