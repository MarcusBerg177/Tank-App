// Tank-App/app.js
// --- DEINE API KEYS ---
const TANKERKOENIG_API_KEY = 'f518c5a2-e10a-46fc-8cca-e527353cfa2f'.trim();
const ORS_API_KEY =
  'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjFjNzYzZjM2NTVjYjQxOWM4ZTI1NmVjNGY4NTdjODZhIiwiaCI6Im11cm11cjY0In0='.trim();

document.getElementById('calcBtn').addEventListener('click', startCalculation);

let favorites = JSON.parse(localStorage.getItem('favStations')) || [];

async function startCalculation() {
  // drei separate Felder
  const street = document.getElementById('street').value.trim();
  const number = document.getElementById('number').value.trim();
  const zip = document.getElementById('zip').value.trim();
  const city = document.getElementById('city').value.trim();

  const consumption = parseFloat(document.getElementById('consumption').value);
  const tankAmount = parseFloat(document.getElementById('tankAmount').value);
  const fuelType = document.getElementById('fuelType').value;
  const radius = document.getElementById('radius').value;

  // Abbruch-Check: Mindestens PLZ oder Ort muss da sein
  if (!zip && !city) {
    alert('Bitte gib zumindest eine PLZ oder einen Ort ein.');
    return;
  }

  showLoader(true, false);
  document.getElementById('title-raw').classList.add('hidden');
  document.getElementById('title-calc').classList.add('hidden');
  document.getElementById('rawResultsList').innerHTML = '';
  document.getElementById('calcResultsList').innerHTML = '';

  try {
    // 1. Text zu Koordinaten (mit den neuen 3 Parametern)
    const coords = await geocodeLocation(street, number, zip, city);

    // 2. Tankstellen abrufen
    const rawStations = await fetchStations(
      coords.lat,
      coords.lng,
      radius,
      fuelType
    );
    const stations = rawStations.filter(
      (station) => station.price !== null && station.isOpen
    );

    if (stations.length === 0)
      throw new Error(
        'Keine geöffneten Tankstellen im gewählten Umkreis gefunden.'
      );

    // 3. Top 20 isolieren und rendern
    const top20Raw = stations.slice(0, 20);
    document.getElementById('title-raw').classList.remove('hidden');
    renderList(top20Raw, 'rawResultsList', false);

    showLoader(false, true);

    // 4. Parallele Routenberechnung für die echten Kosten
    const routePromises = top20Raw.map(async (station) => {
      try {
        const distanceInfo = await calculateRoute(coords, {
          lat: station.lat,
          lng: station.lng,
        });
        const totalDriveKm = (distanceInfo.distance / 1000) * 2; // HIN & ZURÜCK
        const fuelCost = tankAmount * station.price;
        const driveCost = (consumption / 100) * totalDriveKm * station.price;
        const trueTotal = fuelCost + driveCost;

        return { ...station, totalDriveKm, fuelCost, driveCost, trueTotal };
      } catch (err) {
        return null;
      }
    });

    const resultsArray = await Promise.all(routePromises);
    const finalResults = resultsArray.filter((r) => r !== null);

    // Nach echten Kosten sortieren und Top 10 isolieren
    finalResults.sort((a, b) => a.trueTotal - b.trueTotal);
    const top10Calc = finalResults.slice(0, 10);

    // Rechte Spalte rendern
    document.getElementById('title-calc').classList.remove('hidden');
    renderList(top10Calc, 'calcResultsList', true);
  } catch (error) {
    alert(error.message);
  } finally {
    showLoader(false, false);
  }
}

// --- API Aufrufe ---
async function geocodeLocation(street, number, zip, city) {
  // Wir bauen den perfekten Such-String für die API
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

  // Ergibt z.B.: "Hauptstraße 37, 26842 Ostrhauderfehn"
  const cleanSearchQuery = queryParts.join(', ');
  console.log('Sende an ORS:', cleanSearchQuery);

  // API-Aufruf (boundary.country=DE verhindert Suchen in Österreich/Schweiz etc.)
  const res = await fetch(
    `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(cleanSearchQuery)}&boundary.country=DE`
  );
  const data = await res.json();

  if (!data.features || data.features.length === 0) {
    throw new Error(
      `Die Adresse '${cleanSearchQuery}' wurde nicht gefunden. Bitte prüfe die Schreibweise.`
    );
  }

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
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { distance: data.features[0].properties.segments[0].distance };
}

// --- UI & Helper ---
function renderList(results, containerId, isCalculated) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  results.forEach((res) => {
    const isFav = favorites.includes(res.id);
    const card = document.createElement('div');
    card.className = `result-card ${isFav ? 'is-favorite' : ''}`;

    const street = res.street || '';
    const houseNumber = res.houseNumber || '';
    const address =
      `${street} ${houseNumber}, ${res.postCode} ${res.place}`.trim();

    const calcDetails = isCalculated
      ? `
        <p><strong>💶 Reiner Preis: ${res.price.toFixed(3)} €/L</strong></p>
        <p style="margin-top: 0.5rem;">⛽ Reine Tankkosten: ${res.fuelCost.toFixed(2)} €</p>
        <p>🚗 Fahrtkosten (${(res.totalDriveKm / 2).toFixed(1)} km Weg / ${res.totalDriveKm.toFixed(1)} km Gesamt): ${res.driveCost.toFixed(2)} €</p>
        <p class="total-price-highlight"><strong>🔥 Echtes Total: ${res.trueTotal.toFixed(2)} €</strong></p>
    `
      : `<p><strong>💶 Reiner Preis: ${res.price.toFixed(3)} €/L</strong></p>`;

    card.innerHTML = `
      <div class="station-header">
          <div class="station-name">${res.brand || 'Freie Tankstelle'}</div>
      </div>
      <div class="station-address">📍 ${address}</div>
      <div class="station-details">
          ${calcDetails}
      </div>
      <label class="fav-checkbox">
          <input type="checkbox" onchange="toggleFavorite('${res.id}')" ${isFav ? 'checked' : ''}> Favorit
      </label>
    `;
    container.appendChild(card);
  });
}

window.toggleFavorite = function (id) {
  if (favorites.includes(id)) {
    favorites = favorites.filter((favId) => favId !== id);
  } else {
    favorites.push(id);
  }
  localStorage.setItem('favStations', JSON.stringify(favorites));
  // Wir updaten die Listen sofort optisch, ohne neuen API-Aufruf
  if (document.getElementById('rawResultsList').innerHTML !== '')
    document.getElementById('calcBtn').click();
};

function showLoader(mainLoader, calcLoader) {
  document.getElementById('loader').classList.toggle('hidden', !mainLoader);
  document
    .getElementById('loader-calc')
    .classList.toggle('hidden', !calcLoader);
}

// --- PWA Setup & Auto-Update ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('sw.js')
    .then((registration) => {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            console.log('Neues Update gefunden! Lade Seite neu...');
            window.location.reload();
          }
        });
      });
    })
    .catch((err) => console.log('SW Setup fehlgeschlagen', err));
}
