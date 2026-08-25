import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const SWIPE_THRESHOLD_PX = 48;

function clampIndex(index, length) {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

export default function ImageLightbox({
  images = [],
  initialIndex = 0,
  onClose,
}) {
  const safeImages = Array.isArray(images) ? images.filter((item) => item?.url) : [];
  const [index, setIndex] = useState(() => clampIndex(initialIndex, safeImages.length));
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  useEffect(() => {
    setIndex(clampIndex(initialIndex, safeImages.length));
  }, [initialIndex, safeImages.length]);

  const hasMany = safeImages.length > 1;
  const current = safeImages[index] || safeImages[0];

  const goPrev = useCallback(() => {
    setIndex((prev) => (prev <= 0 ? safeImages.length - 1 : prev - 1));
  }, [safeImages.length]);

  const goNext = useCallback(() => {
    setIndex((prev) => (prev >= safeImages.length - 1 ? 0 : prev + 1));
  }, [safeImages.length]);

  useEffect(() => {
    if (!safeImages.length) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (!hasMany) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [safeImages.length, hasMany, goPrev, goNext, onClose]);

  const onTouchStart = (event) => {
    if (!hasMany || event.touches.length !== 1) return;
    touchStartX.current = event.touches[0].clientX;
    touchStartY.current = event.touches[0].clientY;
  };

  const onTouchEnd = (event) => {
    if (!hasMany || touchStartX.current == null || event.changedTouches.length !== 1) return;
    const dx = event.changedTouches[0].clientX - touchStartX.current;
    const dy = event.changedTouches[0].clientY - (touchStartY.current ?? 0);
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) goPrev();
    else goNext();
  };

  if (!safeImages.length || !current) return null;

  return createPortal(
    <div
      className="image-lightbox fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button
        type="button"
        className="image-lightbox-backdrop absolute inset-0 bg-black/80 backdrop-blur-md"
        aria-label="Close image preview"
        onClick={() => onClose?.()}
      />

      <div className="image-lightbox-panel relative z-10 flex h-full w-full max-w-6xl flex-col">
        <div className="mb-2 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0 flex-1 text-left">
            {current.alt ? (
              <p className="truncate text-xs sm:text-sm text-slate-300">{current.alt}</p>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500">Image preview</p>
            )}
            {hasMany ? (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {index + 1} / {safeImages.length}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-icon shrink-0 rounded-full border border-white/10 bg-black/40 text-slate-300 hover:text-white"
            aria-label="Close"
            onClick={() => onClose?.()}
          >
            <X size={18} />
          </button>
        </div>

        <div
          className="image-lightbox-stage relative flex flex-1 min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30 overflow-hidden touch-pan-y"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <img
            key={current.url}
            src={current.url}
            alt={current.alt || 'image'}
            className="image-lightbox-image max-h-[min(78vh,900px)] max-w-full object-contain select-none"
            draggable={false}
          />

          {hasMany ? (
            <>
              <button
                type="button"
                className="image-lightbox-nav image-lightbox-nav-prev hidden sm:inline-flex"
                aria-label="Previous image"
                onClick={(event) => {
                  event.stopPropagation();
                  goPrev();
                }}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="image-lightbox-nav image-lightbox-nav-next hidden sm:inline-flex"
                aria-label="Next image"
                onClick={(event) => {
                  event.stopPropagation();
                  goNext();
                }}
              >
                <ChevronRight size={22} />
              </button>
            </>
          ) : null}
        </div>

        {hasMany ? (
          <div className="mt-3 flex items-center justify-center gap-2 sm:hidden">
            <button
              type="button"
              className="btn-secondary py-2 px-3 text-xs"
              onClick={goPrev}
            >
              Précédent
            </button>
            <button
              type="button"
              className="btn-secondary py-2 px-3 text-xs"
              onClick={goNext}
            >
              Suivant
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
