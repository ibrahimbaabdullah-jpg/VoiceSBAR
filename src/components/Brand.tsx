export const APP_NAME = 'VoiceSBAR';
export const APP_AUTHOR = 'Ibrahim Baabdullah';
export const APP_TAGLINE = 'Dictated SBAR handoffs';

/** Logo, product name and author line shown at the top of every screen. */
export function Brand({ size = 'normal', tag = true }: { size?: 'normal' | 'big'; tag?: boolean }) {
  const icon = size === 'big' ? 44 : 32;
  return (
    <div className={`brand ${size === 'big' ? 'big' : ''}`}>
      <img src="/favicon.svg" alt="" width={icon} height={icon} />
      <div className="brand-text">
        <span className="brand-name">
          <span dir="ltr">
            Voice<b>SBAR</b>
          </span>
          {size === 'normal' && tag && <span className="brand-tag">{APP_TAGLINE}</span>}
        </span>
        <span className="brand-by">by {APP_AUTHOR}</span>
      </div>
    </div>
  );
}
