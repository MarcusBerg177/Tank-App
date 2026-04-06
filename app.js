// // Pfad: Tank-App/app.js
// --- DEINE API KEYS ---
const TANKERKOENIG_API_KEY = 'f518c5a2-e10a-46fc-8cca-e527353cfa2f'.trim();
const ORS_API_KEY =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjFjNzYzZjM2NTVjYjQxOWM4ZTI1NmVjNGY4NTdjODZhIiwiaCI6Im11cm11cjY0In0='.trim();

// Favoriten laden und sofort fehlerhafte/alte Einträge (reine Strings) aussortieren!
let rawFavs = JSON.parse(localStorage.getItem('favStationsData')) || [];
let favorites = rawFavs.filter(
  (f) => typeof f === 'object' && f.id && f.price !== undefined
);

let currentRawStations = [];
let currentCalcStations = [];

document.getElementById('calcBtn').addEventListener('click', startCalculation);
document
  .getElementById('toggleFilterBtn')
  .addEventListener('click', toggleFilter);

// Favoriten direkt beim Start anzeigen
document.addEventListener('DOMContentLoaded', () => {
  updateFavoritesTab();
});

function toggleFilter() {
  const filter = document.getElementById('filterSection');
  const btn = document.getElementById('toggleFilterBtn');
  filter.classList.toggle('hidden');
  if (filter.classList.contains('hidden')) {
    btn.innerText = '▼ Suchfilter & Fahrzeug anpassen';
  } else {
    btn.innerText = '▲ Suchfilter einklappen';
  }
}

// Tab Switching
document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => {
    document
      .querySelectorAll('.tab-btn')
      .forEach((btn) => btn.classList.remove('active'));
    document
      .querySelectorAll('.tab-content')
      .forEach((content) => content.classList.remove('active'));

    button.classList.add('active');
    const targetId = button.getAttribute('data-target');
    document.getElementById(targetId).classList.add('active');
  });
});

// --- HAUPTBERECHNUNG ---
async function startCalculation() {
  const street = document.getElementById('street').value.trim();
  const number = document.getElementById('number').value.trim();
  const zip = document.getElementById('zip').value.trim();
  const city = document.getElementById('city').value.trim();

  const consumption = parseFloat(document.getElementById('consumption').value);
  const tankAmount = parseFloat(document.getElementById('tankAmount').value);
  const fuelType = document.getElementById('fuelType').value;
  const radius = document.getElementById('radius').value;

  if (!zip && !city) {
    alert('Bitte PLZ oder Ort angeben.');
    return;
  }

  const filterSection = document.getElementById('filterSection');
  if (!filterSection.classList.contains('hidden')) {
    toggleFilter();
  }

  setLoader(true, 'Frage Markttransparenzstelle ab...');
  document.getElementById('rawResultsList').innerHTML = '';
  document.getElementById('calcResultsList').innerHTML = '';

  try {
    const coords = await geocodeLocation(street, number, zip, city);

    const rawStations = await fetchStations(
      coords.lat,
      coords.lng,
      radius,
      fuelType
    );
    currentRawStations = rawStations.filter(
      (s) => s.price !== null && s.isOpen
    );

    if (currentRawStations.length === 0)
      throw new Error('Keine geöffneten Tankstellen gefunden.');

    // 1. REITER: Bester Preis (Modus: 'raw')
    const top20Raw = currentRawStations.slice(0, 20);
    renderList(top20Raw, 'rawResultsList', 'raw');

    // 3. REITER: Favoriten updaten (falls sich Preise geändert haben)
    updateFavoritesTab();

    // 2. REITER: Realer Preis (Modus: 'calc')
    setLoader(true, 'Berechne echte Fahrstrecken...');
    const finalResults = [];

    for (let station of top20Raw) {
      // Notfall-Plan: Tankerkönig liefert die Luftlinie (station.dist) direkt mit.
      // Wir multiplizieren mit 1.3 als grobe Schätzung für die Straßenführung.
      let routeDistKm = station.dist * 1.3;
      let isFallback = true;

      try {
        const distanceInfo = await calculateRoute(coords, {
          lat: station.lat,
          lng: station.lng,
        });
        if (distanceInfo.distance) {
          routeDistKm = distanceInfo.distance / 1000;
          isFallback = false;
        }
      } catch (err) {
        console.warn(
          `ORS Limit bei ${station.brand}. Nutze Luftlinien-Schätzung.`
        );
      }

      const totalDriveKm = routeDistKm * 2; // Hin und Zurück
      const fuelCost = tankAmount * station.price;
      const driveCost = (consumption / 100) * totalDriveKm * station.price;

      finalResults.push({
        ...station,
        routeDistKm,
        totalDriveKm,
        fuelCost,
        driveCost,
        trueTotal: fuelCost + driveCost,
        isFallback,
      });

      // 150ms Pause schont die API
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    finalResults.sort((a, b) => a.trueTotal - b.trueTotal);
    currentCalcStations = finalResults.slice(0, 10);

    renderList(currentCalcStations, 'calcResultsList', 'calc');
  } catch (error) {
    alert(error.message);
  } finally {
    setLoader(false);
  }
}

// --- API FUNKTIONEN ---
async function geocodeLocation(street, number, zip, city) {
  let queryParts = [];
  if (street) {
    let streetPart = street;
    if (number) streetPart += ' ' + number;
    queryParts.push(streetPart);
  }
  let cityPart = [];
  if (zip) cityPart.push(zip);
  if (city) cityPart.push(city);
  if (cityPart.length > 0) queryParts.push(cityPart.join(' '));

  const cleanQuery = queryParts.join(', ');
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(cleanQuery)}&boundary.country=DE`
  );
  const data = await res.json();
  if (!data.features || data.features.length === 0)
    throw new Error(`Adresse '${cleanQuery}' nicht gefunden.`);
  return {
    lng: data.features[0].geometry.coordinates[0],
    lat: data.features[0].geometry.coordinates[1],
  };
}

async function fetchStations(lat, lng, radius, type) {
  const res = await fetch(
    `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lng}&rad=${radius}&sort=price&type=${type}&apikey=${TANKERKOENIG_API_KEY}`
  );
  const data = await res.json();
  if (!data.ok) throw new Error(data.message);
  return data.stations;
}

async function calculateRoute(start, end) {
  const res = await fetch(
    `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_API_KEY}&start=${start.lng},${start.lat}&end=${end.lng},${end.lat}`
  );
  if (!res.ok) throw new Error('API Block / Limit erreicht');
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { distance: data.features[0].properties.segments[0].distance };
}

// --- UI FUNKTIONEN ---
function renderList(results, containerId, mode) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (results.length === 0) {
    container.innerHTML =
      '<p class="text-center text-muted" style="margin-top: 2rem;">Keine Daten verfügbar.</p>';
    return;
  }

  results.forEach((res) => {
    const isFav = favorites.some((fav) => fav.id === res.id);
    const card = document.createElement('div');
    card.className = `result-card ${isFav ? 'is-favorite' : ''}`;

    const brand = res.brand || 'Freie Tankstelle';
    const address =
      `${res.street || ''} ${res.houseNumber || ''}, ${res.postCode} ${res.place}`.trim();

    // Fallback: Tankerkönig liefert die Luftlinie (dist) standardmäßig mit
    const rawDist = res.dist ? res.dist.toFixed(1) : '?';
    const priceStr = res.price ? res.price.toFixed(3) : '?.???';

    // 1. TEIL: Immer sichtbar (Name, Adresse, Preis, Entfernung)
    let contentHTML = `
      <div class="station-header">${brand}</div>
      <div class="station-address">📍 ${address}</div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
          <span class="price-neon">${priceStr} €/L</span>
          <span class="text-muted" style="font-size: 0.85rem;">🚗 ${rawDist} km entfernt</span>
      </div>
    `;

    // 2. TEIL: Nur im Reiter "Realer Preis" sichtbar (Detail-Berechnung)
    if (mode === 'calc') {
      const driveTotalKm = res.totalDriveKm ? res.totalDriveKm.toFixed(1) : '?';
      const warning = res.isFallback
        ? ' <span title="Schätzwert via Luftlinie (API Limit)">⚠️</span>'
        : '';

      contentHTML += `
        <div class="total-price-highlight">
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.3rem; line-height: 1.4;">
                ⛽ Reines Tanken: ${res.fuelCost.toFixed(2)} €<br>
                🛣️ Fahrt (${driveTotalKm} km Hin/Zurück): ${res.driveCost.toFixed(2)} € ${warning}
            </p>
            <p style="font-size: 1.1rem; font-weight: 600; color: #fff; margin-top: 0.5rem;">
                Gesamtpreis: ${res.trueTotal.toFixed(2)} €
            </p>
        </div>
      `;
    }

    // Checkbox für Favoriten anfügen
    card.innerHTML =
      contentHTML +
      `
      <label class="fav-checkbox">
          <input type="checkbox" onchange="toggleFavorite('${res.id}')" ${isFav ? 'checked' : ''}>
          <span class="star">★</span>
      </label>
    `;

    container.appendChild(card);
  });
}

function updateFavoritesTab() {
  // Zeige Favoriten im 'raw' Modus an (ohne Fahrtkosten-Berechnung, da der Standort wechseln kann)
  renderList(favorites, 'favResultsList', 'raw');
}

window.toggleFavorite = function (id) {
  const index = favorites.findIndex((fav) => fav.id === id);

  if (index > -1) {
    favorites.splice(index, 1); // Entfernen
  } else {
    // Komplettes Tankstellen-Objekt suchen und speichern
    const stationObj =
      currentRawStations.find((s) => s.id === id) ||
      currentCalcStations.find((s) => s.id === id);
    if (stationObj) {
      favorites.push(stationObj);
    }
  }

  localStorage.setItem('favStationsData', JSON.stringify(favorites));

  // Listen aktualisieren, ohne den Server neu anzufragen
  if (currentRawStations.length > 0)
    renderList(currentRawStations.slice(0, 20), 'rawResultsList', 'raw');
  if (currentCalcStations.length > 0)
    renderList(currentCalcStations, 'calcResultsList', 'calc');
  updateFavoritesTab();
};

function setLoader(show, text = '') {
  document.getElementById('loader').classList.toggle('hidden', !show);
  if (text) document.getElementById('loader-text').innerText = text;
}
