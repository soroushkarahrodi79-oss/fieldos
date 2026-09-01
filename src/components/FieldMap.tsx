import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// MapLibre GL JS v6 ships named/namespace exports only (no default export), so import the namespace.
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { captureCurrentLocation } from '../domain/geolocation';
import { assetTypeLabels, categoryLabels, readable } from '../domain/labels';
import type { Asset, Observation, Uuid } from '../domain/types';
import { assetMapFeatures } from '../spatial/assetMapFeature';
import { basemapUnavailableMessage, buildBasemapStyle } from '../spatial/basemap';
import { deviceMapFeature } from '../spatial/deviceMapFeature';
import { observationMapFeatures } from '../spatial/observationMapFeature';
import { findAssetFeature, findObservationFeature } from '../spatial/selection';
import { collectCoordinates, computeViewport } from '../spatial/viewport';
import type { AssetMapFeature, DeviceMapFeature, ObservationMapFeature } from '../spatial/mapTypes';

interface FieldMapProps {
  observations: readonly Observation[];
  assets: readonly Asset[];
  /** Open the existing full observation-detail screen. */
  onOpenObservation: (id: Uuid) => void;
}

type Selection =
  | { kind: 'observation'; id: Uuid }
  | { kind: 'asset'; id: Uuid }
  | null;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Build a styled, accessible marker element for one feature (shape + text, never colour alone). */
function markerElement(
  feature: ObservationMapFeature | AssetMapFeature | DeviceMapFeature,
): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `map-marker map-marker-${feature.kind}`;

  if (feature.kind === 'observation') {
    const label = categoryLabels[feature.category];
    el.classList.add(`placement-${feature.placement}`);
    el.textContent = label.slice(0, 1);
    el.setAttribute(
      'aria-label',
      `Observation: ${label}${feature.value ? ` ${readable(feature.value)}` : ''}, ` +
        `${feature.placement === 'adjusted' ? 'manually adjusted position' : 'captured position'}`,
    );
    if (feature.placement === 'adjusted') {
      const badge = document.createElement('span');
      badge.className = 'marker-adjusted-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '✎';
      el.appendChild(badge);
    }
  } else if (feature.kind === 'asset') {
    el.textContent = '◆';
    const type = feature.assetType ? assetTypeLabels[feature.assetType] : 'Unclassified';
    el.setAttribute('aria-label', `Asset: ${feature.name}, ${type}`);
  } else {
    el.textContent = '';
    el.setAttribute('aria-label', 'Your current position');
  }
  return el;
}

export function FieldMap({ observations, assets, onOpenObservation }: FieldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  const [device, setDevice] = useState<DeviceMapFeature | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [ready, setReady] = useState(false);

  const observationFeatures = useMemo(
    () => observationMapFeatures(observations),
    [observations],
  );
  const assetFeatures = useMemo(() => assetMapFeatures(assets), [assets]);

  const selectedObservation =
    selection?.kind === 'observation' ? findObservationFeature(observationFeatures, selection.id) : null;
  const selectedAsset =
    selection?.kind === 'asset' ? findAssetFeature(assetFeatures, selection.id) : null;

  // One single current-position fix (never watchPosition). Non-fatal on denial.
  const locateMe = useCallback(async () => {
    setLocating(true);
    const fix = await captureCurrentLocation();
    const feature = deviceMapFeature(fix);
    setDevice(feature);
    setLocationDenied(feature === null);
    setLocating(false);
    if (feature && mapRef.current) {
      mapRef.current.easeTo({
        center: [feature.coordinate.longitude, feature.coordinate.latitude],
        zoom: Math.max(mapRef.current.getZoom(), 15),
      });
    }
  }, []);

  // Initialise the map once. The style is INLINE, so construction never needs the network.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const coordinates = collectCoordinates(observationFeatures, assetFeatures);
    const viewport = computeViewport(coordinates);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBasemapStyle() as unknown as StyleSpecification,
      center:
        viewport.kind === 'point'
          ? viewport.center
          : viewport.kind === 'bounds'
            ? [
                (viewport.bounds[0][0] + viewport.bounds[1][0]) / 2,
                (viewport.bounds[0][1] + viewport.bounds[1][1]) / 2,
              ]
            : [0, 20],
      zoom: viewport.kind === 'point' ? viewport.zoom : 2,
      attributionControl: { compact: true },
      // Keep the field-tool minimal: no rotation/pitch surprises for one-handed outdoor use.
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      setReady(true);
      if (viewport.kind === 'bounds') {
        map.fitBounds(viewport.bounds, { padding: 64, maxZoom: 16, animate: false });
      }
    });

    // Tile-load failures surface as 'error'. When offline (or tiles simply fail) we tell the user
    // the basemap is unavailable but keep the overlays — the map itself never crashes the app.
    map.on('error', (event) => {
      const message = event.error?.message ?? '';
      if (!navigator.onLine || /tile|fetch|load|network/i.test(message)) {
        setBasemapDown(true);
      }
    });
    map.on('data', (event) => {
      if (event.dataType === 'source' && (event as { tile?: unknown }).tile && navigator.onLine) {
        setBasemapDown(false);
      }
    });

    mapRef.current = map;

    const resize = () => map.resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => map.resize())
        : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Intentionally run once; feature updates are handled by the marker effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Try a first position fix on open (does nothing harmful if denied).
  useEffect(() => {
    void locateMe();
  }, [locateMe]);

  // (Re)draw markers whenever features or the device fix change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const add = (
      feature: ObservationMapFeature | AssetMapFeature | DeviceMapFeature,
      onClick?: () => void,
    ) => {
      const el = markerElement(feature);
      if (onClick) el.addEventListener('click', onClick);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([feature.coordinate.longitude, feature.coordinate.latitude])
        .addTo(map);
      markersRef.current.push(marker);
    };

    // Draw order = tap priority. The device pin has no action, so it goes at the BOTTOM; assets
    // next; observations on TOP so a record sitting under the "you are here" dot stays tappable.
    if (device) add(device);
    for (const feature of assetFeatures) {
      add(feature, () => setSelection({ kind: 'asset', id: feature.id }));
    }
    for (const feature of observationFeatures) {
      add(feature, () => setSelection({ kind: 'observation', id: feature.id }));
    }
  }, [observationFeatures, assetFeatures, device, ready]);

  const nothingToShow =
    observationFeatures.length === 0 && assetFeatures.length === 0 && device === null;

  return (
    <div className="field-map-wrap">
      <div className="field-map-frame">
        <div ref={containerRef} className="field-map" role="application" aria-label="Field map" />

        {basemapDown && !nothingToShow && (
          <div className="map-banner map-banner-warn" role="status">
            {basemapUnavailableMessage(navigator.onLine)}
          </div>
        )}

        {/* No coordinates anywhere → cover the (otherwise arbitrary) world map with an honest
            empty state instead of dropping the researcher onto a random global view. */}
        {nothingToShow && ready && (
          <div className="map-empty-overlay" role="status">
            <strong>Nothing to map yet.</strong>
            <span>
              No observations or assets have coordinates, and no current position is available.
              Records without a location still live in the session list.
            </span>
          </div>
        )}

        {selectedObservation && (
          <ObservationCard
            feature={selectedObservation}
            onOpen={() => onOpenObservation(selectedObservation.id)}
            onClose={() => setSelection(null)}
          />
        )}
        {selectedAsset && <AssetCard feature={selectedAsset} onClose={() => setSelection(null)} />}
      </div>

      <div className="map-toolbar">
        <button
          type="button"
          className="secondary map-locate"
          onClick={() => void locateMe()}
          disabled={locating}
        >
          {locating ? 'Locating…' : '◎ My location'}
        </button>
        {locationDenied && (
          <span className="map-locate-note">
            Location unavailable — the map still shows your records.
          </span>
        )}
      </div>

      <div className="map-legend" aria-label="Map legend">
        <span className="legend-item">
          <span className="legend-swatch legend-observation" aria-hidden="true">
            •
          </span>
          Observation
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-adjusted" aria-hidden="true">
            ✎
          </span>
          Adjusted position
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-asset" aria-hidden="true">
            ◆
          </span>
          Asset
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-device" aria-hidden="true" />
          You
        </span>
      </div>
    </div>
  );
}

function ObservationCard({
  feature,
  onOpen,
  onClose,
}: {
  feature: ObservationMapFeature;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <section className="map-card" role="dialog" aria-label="Observation summary">
      <button className="map-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="eyebrow">Observation</div>
      <h2>{categoryLabels[feature.category]}</h2>
      <dl className="map-card-grid">
        <div>
          <dt>Value</dt>
          <dd>{feature.value ? readable(feature.value) : 'Free observation'}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{readable(feature.evidenceMethod)}</dd>
        </div>
        <div>
          <dt>Captured</dt>
          <dd>{formatTime(feature.capturedAt)}</dd>
        </div>
        <div>
          <dt>Mapped position</dt>
          <dd>
            {feature.placement === 'adjusted' ? 'Manually adjusted' : 'Captured GPS'}
            {feature.placement === 'captured' && feature.accuracyMeters !== null
              ? ` · ±${Math.round(feature.accuracyMeters)}m`
              : ''}
          </dd>
        </div>
      </dl>
      {feature.placement === 'adjusted' && (
        <p className="map-card-provenance">Original GPS retained in provenance — not overwritten.</p>
      )}
      <button className="primary map-card-action" onClick={onOpen}>
        Open full observation →
      </button>
    </section>
  );
}

function AssetCard({ feature, onClose }: { feature: AssetMapFeature; onClose: () => void }) {
  return (
    <section className="map-card" role="dialog" aria-label="Asset summary">
      <button className="map-card-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="eyebrow">Asset</div>
      <h2>{feature.name}</h2>
      <dl className="map-card-grid">
        <div>
          <dt>Type</dt>
          <dd>{feature.assetType ? assetTypeLabels[feature.assetType] : 'Unclassified'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{feature.source === 'preloaded' ? 'Preloaded' : 'Field-created'}</dd>
        </div>
        <div>
          <dt>Coordinates</dt>
          <dd>
            {feature.coordinate.latitude.toFixed(5)}, {feature.coordinate.longitude.toFixed(5)}
          </dd>
        </div>
      </dl>
      <p className="map-card-provenance">Read-only. Assets are managed from the session screen.</p>
    </section>
  );
}
