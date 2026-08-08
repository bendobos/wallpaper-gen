import type { Params } from '../params/schema';
import type { KeptLook } from '../params/serialize';

interface Props {
  looks: KeptLook[];
  onApply: (params: Params) => void;
  onRemove: (id: string) => void;
}

/**
 * Thumbnails of looks worth coming back to.
 *
 * Undo is a single linear stack, so a good result found two experiments ago is
 * simply gone. Pinning it costs one click and survives a reload.
 */
export default function KeepShelf({ looks, onApply, onRemove }: Props) {
  if (!looks.length) return null;

  return (
    <div className="shelf">
      {looks.map((look) => (
        <span key={look.id} className="shelf-item">
          <button
            onClick={() => onApply(look.params)}
            title="Restore this look"
            aria-label="Restore kept look"
            style={{ border: 'none', background: 'none', padding: 0, lineHeight: 0 }}
          >
            <img src={look.thumb} alt="" />
          </button>
          <button className="x" onClick={() => onRemove(look.id)} aria-label="Remove kept look">
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}
