export const APP_NAME = 'VoiceScribe';
export const APP_AUTHOR = 'Ibrahim Baabdullah';
export const APP_TAGLINE = 'AI-Powered Speech-to-Text';

/** Logo, product name and author line shown at the top of every screen. */
export function Brand({ size = 'normal' }: { size?: 'normal' | 'big' }) {
  const icon = size === 'big' ? 44 : 32;
  return (
    <div className={`brand ${size === 'big' ? 'big' : ''}`}>
      <img src="/favicon.svg" alt="" width={icon} height={icon} />
      <div className="brand-text">
        <span className="brand-name">
          {APP_NAME}
          {size === 'normal' && <span className="brand-tag">{APP_TAGLINE}</span>}
        </span>
        <span className="brand-by">by {APP_AUTHOR}</span>
      </div>
    </div>
  );
}
