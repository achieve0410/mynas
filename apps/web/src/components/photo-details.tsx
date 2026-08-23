import type { Photo } from "../schemas";

type PhotoDetailsProps = {
  readonly albumNames: readonly string[];
  readonly photo: Photo;
};

export const PhotoDetails = ({ albumNames, photo }: PhotoDetailsProps) => (
  <details className="lightbox-meta">
    <summary>Photo details</summary>
    <dl className="definition-list compact">
      <div>
        <dt>Captured</dt>
        <dd>
          <time data-testid="photo-captured-at" dateTime={photo.capturedAt}>
            {new Date(photo.capturedAt).toLocaleString()}
          </time>
        </dd>
      </div>
      <div>
        <dt>Imported</dt>
        <dd>{new Date(photo.importedAt).toLocaleString()}</dd>
      </div>
      {photo.location === null ? null : (
        <div>
          <dt>Location</dt>
          <dd className="photo-location">
            <span data-testid="photo-location">
              {photo.location.latitude.toFixed(6)}, {photo.location.longitude.toFixed(6)}
            </span>
            <a
              aria-label="Open location in Maps"
              href={`https://maps.apple.com/?${new URLSearchParams({
                ll: `${photo.location.latitude.toFixed(6)},${photo.location.longitude.toFixed(6)}`,
              })}`}
              rel="noreferrer"
              target="_blank"
            >
              Maps
            </a>
          </dd>
        </div>
      )}
      <div>
        <dt>SHA-256</dt>
        <dd className="mono checksum">{photo.checksum}</dd>
      </div>
      {albumNames.length === 0 ? null : (
        <div>
          <dt>Albums</dt>
          <dd>{albumNames.join(", ")}</dd>
        </div>
      )}
    </dl>
  </details>
);
