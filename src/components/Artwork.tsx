import React from 'react';
import { useSyncPhotos } from '../contexts/SyncPhotosContext';

export interface ArtworkProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  placeholderClassName?: string;
}

export const Artwork: React.FC<ArtworkProps> = ({ src, alt = '', className, loading, decoding, onError, ...rest }) => {
  const syncPhotos = useSyncPhotos();
  if (!syncPhotos) {
    return (
      <span
        aria-hidden="true"
        className={(className ? className + ' ' : '') + 'artwork-placeholder'}
        {...(rest as React.HTMLAttributes<HTMLSpanElement>)}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding={decoding}
      onError={onError}
      {...rest}
    />
  );
};
