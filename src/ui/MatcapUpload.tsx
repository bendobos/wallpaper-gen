import { useRef, useState } from 'react';
import { imageToMatcap } from '../params/matcaps';

interface Props {
  /** Name of the image currently loaded, or null if none is. */
  loaded: string | null;
  onLoad: (name: string, levels: ImageData[]) => void;
  onClear: () => void;
}

/**
 * File picker for a custom matcap.
 *
 * Shown only when Environment is set to Custom. The limitation note is not
 * optional decoration: every other parameter in this app travels in a share
 * link, and this one cannot, so the one place a user could be surprised by that
 * is the place that says so.
 */
export default function MatcapUpload({ loaded, onLoad, onClear }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onLoad(file.name, await imageToMatcap(file));
    } catch {
      setError(`Could not read “${file.name}” as an image.`);
    }
  };

  return (
    <div className="row">
      <div className="row-head">
        <span className="row-label">Custom matcap</span>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          // Clear the value so re-picking the same file fires change again.
          e.target.value = '';
        }}
      />

      <div className="color-row">
        <button className="btn" style={{ flex: 1 }} onClick={() => input.current?.click()}>
          {loaded ? '⤒ Replace image' : '⤒ Choose image'}
        </button>
        {loaded && (
          <button className="btn icon" onClick={onClear} aria-label="Remove custom matcap">
            ✕
          </button>
        )}
      </div>

      {loaded ? (
        <p className="note">
          {loaded} · scaled to 256×256. It <strong>will not travel in a share link</strong> —
          opening one made with it falls back to the procedural environment.
        </p>
      ) : (
        <p className="note warn">
          No image loaded, so this is rendering with the procedural environment. Any lit-sphere
          (matcap) image works; so does a photo, loosely.
        </p>
      )}

      {error && <p className="note error">{error}</p>}
    </div>
  );
}
