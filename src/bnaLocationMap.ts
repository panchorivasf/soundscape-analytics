import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "SoundscapeAnalytics/0.1 (BirdNET location picker)";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let initialized = false;

const $ = (id: string) => document.getElementById(id)!;

/** Fix Leaflet default icon paths under Vite bundling. */
function fixLeafletIcons(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
}

function readLatLon(): { lat: number | null; lon: number | null } {
  const latRaw = ($("bna-lat") as HTMLInputElement).value.trim();
  const lonRaw = ($("bna-lon") as HTMLInputElement).value.trim();
  const lat = latRaw ? Number(latRaw) : null;
  const lon = lonRaw ? Number(lonRaw) : null;
  return {
    lat: lat != null && Number.isFinite(lat) ? lat : null,
    lon: lon != null && Number.isFinite(lon) ? lon : null,
  };
}

function setLatLon(lat: number, lon: number, label?: string): void {
  ($("bna-lat") as HTMLInputElement).value = lat.toFixed(5);
  ($("bna-lon") as HTMLInputElement).value = lon.toFixed(5);
  const labelEl = $("bna-location-label");
  labelEl.textContent = label ?? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  placeMarker(lat, lon);
}

function placeMarker(lat: number, lon: number): void {
  if (!map) return;
  if (marker) {
    marker.setLatLng([lat, lon]);
  } else {
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker!.getLatLng();
      ($("bna-lat") as HTMLInputElement).value = pos.lat.toFixed(5);
      ($("bna-lon") as HTMLInputElement).value = pos.lng.toFixed(5);
      $("bna-location-label").textContent = `${pos.lat.toFixed(4)}°, ${pos.lng.toFixed(4)}°`;
    });
  }
  map.setView([lat, lon], Math.max(map.getZoom(), 8));
}

function ensureMap(): void {
  if (initialized) {
    map?.invalidateSize();
    return;
  }

  fixLeafletIcons();
  const container = $("bna-map");
  const { lat, lon } = readLatLon();
  const startLat = lat ?? 20;
  const startLon = lon ?? 0;
  const startZoom = lat != null && lon != null ? 8 : 2;

  map = L.map(container, {
    center: [startLat, startLon],
    zoom: startZoom,
    scrollWheelZoom: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(map);

  map.on("click", (e) => {
    setLatLon(e.latlng.lat, e.latlng.lng);
  });

  if (lat != null && lon != null) {
    placeMarker(lat, lon);
  }

  initialized = true;
  requestAnimationFrame(() => map?.invalidateSize());
}

function hideResults(): void {
  const list = $("bna-place-results");
  list.innerHTML = "";
  list.hidden = true;
}

function showResults(items: NominatimResult[]): void {
  const list = $("bna-place-results");
  list.innerHTML = "";
  if (items.length === 0) {
    list.hidden = true;
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bna-place-item";
    btn.textContent = item.display_name;
    btn.addEventListener("click", () => {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      setLatLon(lat, lon, item.display_name);
      hideResults();
      ($("bna-place-search") as HTMLInputElement).value = item.display_name.split(",")[0] ?? "";
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  list.hidden = false;
}

async function searchPlace(query: string): Promise<void> {
  const q = query.trim();
  if (q.length < 2) return;

  const status = $("bna-map-status");
  status.textContent = "Searching…";

  try {
    const url = `${NOMINATIM}?format=json&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
    const data = (await res.json()) as NominatimResult[];
    showResults(data);
    status.textContent = data.length > 0 ? `${data.length} result(s)` : "No places found.";
    if (data.length === 1) {
      const lat = Number(data[0].lat);
      const lon = Number(data[0].lon);
      setLatLon(lat, lon, data[0].display_name);
      hideResults();
    }
  } catch (e) {
    status.textContent = String(e);
    hideResults();
  }
}

function clearLocation(): void {
  ($("bna-lat") as HTMLInputElement).value = "";
  ($("bna-lon") as HTMLInputElement).value = "";
  ($("bna-place-search") as HTMLInputElement).value = "";
  $("bna-location-label").textContent = "No location set — species list will not be filtered by coordinates.";
  hideResults();
  $("bna-map-status").textContent = "";
  if (marker && map) {
    map.removeLayer(marker);
    marker = null;
  }
}

export function initBnaLocationMap(): void {
  const details = $("bna-location-details");

  details.addEventListener("toggle", () => {
    if ((details as HTMLDetailsElement).open) {
      ensureMap();
      requestAnimationFrame(() => map?.invalidateSize());
    }
  });

  document.querySelectorAll(".main-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if ((tab as HTMLElement).dataset.tab !== "birdnet-analyzer") return;
      if ((details as HTMLDetailsElement).open) {
        requestAnimationFrame(() => {
          ensureMap();
          map?.invalidateSize();
        });
      }
    });
  });

  $("bna-place-search-btn")?.addEventListener("click", () => {
    ensureMap();
    void searchPlace(($("bna-place-search") as HTMLInputElement).value);
  });

  $("bna-place-search")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ensureMap();
      void searchPlace(($("bna-place-search") as HTMLInputElement).value);
    }
  });

  $("bna-clear-location")?.addEventListener("click", clearLocation);

  $("bna-lat")?.addEventListener("change", () => {
    const { lat, lon } = readLatLon();
    if (lat != null && lon != null) {
      ensureMap();
      placeMarker(lat, lon);
    }
  });
  $("bna-lon")?.addEventListener("change", () => {
    const { lat, lon } = readLatLon();
    if (lat != null && lon != null) {
      ensureMap();
      placeMarker(lat, lon);
    }
  });

  $("bna-location-label").textContent =
    "No location set — species list will not be filtered by coordinates.";
}

export function refreshBnaLocationMap(): void {
  if (!initialized) return;
  map?.invalidateSize();
}
