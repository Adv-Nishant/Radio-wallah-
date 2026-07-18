import './style.css'

const API_ENDPOINT =
  'https://all.api.radio-browser.info/json/stations/search?countrycode=IN&hidebroken=true&order=votes&reverse=true&limit=200'

const CURATED_FALLBACK = [
  {
    stationuuid: 'fallback-mirchi',
    name: 'Radio Mirchi 98.3',
    url_resolved: 'http://51.222.87.239:7200/1',
    favicon: '',
    bitrate: 128,
    language: 'Hindi',
    tags: 'bollywood,india,hindi'
  },
  {
    stationuuid: 'fallback-city',
    name: 'Radio City 91.1',
    url_resolved: 'http://51.222.87.239:7200/2',
    favicon: '',
    bitrate: 128,
    language: 'Hindi',
    tags: 'bollywood,india,hindi'
  },
  {
    stationuuid: 'fallback-bigfm',
    name: 'Big FM 92.7',
    url_resolved: 'http://51.222.87.239:7200/3',
    favicon: '',
    bitrate: 128,
    language: 'Hindi',
    tags: 'retro,india,hindi'
  },
  {
    stationuuid: 'fallback-rainbow',
    name: 'AIR Rainbow FM Chennai',
    url_resolved: 'http://23.237.126.42:8000/stream',
    favicon: '',
    bitrate: 64,
    language: 'Tamil',
    tags: 'air,tamil,news'
  },
  {
    stationuuid: 'fallback-air-tamil',
    name: 'AIR Tamil',
    url_resolved: 'http://playerservices.streamtheworld.com/api/livestream-redirect/ALL_INDIA_RADIO_TAMIL.mp3',
    favicon: '',
    bitrate: 64,
    language: 'Tamil',
    tags: 'air,tamil,talk'
  }
]

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="layout">
    <header class="hero">
      <p class="eyebrow">Live Indian Radio</p>
      <h1>Radio Wallah</h1>
      <p class="subtitle">Stream AIR, private FM, and regional stations in one tap-friendly player.</p>
      <div class="filters">
        <label>
          <span>Search</span>
          <input id="searchInput" type="search" placeholder="Station, language, tag" autocomplete="off" />
        </label>
        <label>
          <span>Language</span>
          <select id="languageFilter">
            <option value="all">All languages</option>
          </select>
        </label>
      </div>
      <p id="statusMessage" class="status">Loading stations…</p>
    </header>

    <section class="player" aria-live="polite">
      <div class="now-playing">
        <img id="stationLogo" src="" alt="" />
        <div>
          <p class="label">Now Playing</p>
          <h2 id="stationName">Choose a station</h2>
          <p id="stationMeta">No stream selected</p>
        </div>
      </div>
      <div class="controls">
        <button id="playPauseBtn" type="button" disabled>Play</button>
        <label>
          <span>Volume</span>
          <input id="volumeSlider" type="range" min="0" max="1" step="0.05" value="0.8" />
        </label>
      </div>
      <canvas id="visualizer" width="640" height="110" aria-hidden="true"></canvas>
      <audio id="audioPlayer" crossorigin="anonymous" playsinline preload="none"></audio>
    </section>

    <section>
      <ul id="stationList" class="stations" aria-label="Station list"></ul>
    </section>
  </main>
`

const elements = {
  searchInput: document.querySelector('#searchInput'),
  languageFilter: document.querySelector('#languageFilter'),
  statusMessage: document.querySelector('#statusMessage'),
  playPauseBtn: document.querySelector('#playPauseBtn'),
  volumeSlider: document.querySelector('#volumeSlider'),
  stationList: document.querySelector('#stationList'),
  stationName: document.querySelector('#stationName'),
  stationMeta: document.querySelector('#stationMeta'),
  stationLogo: document.querySelector('#stationLogo'),
  audio: document.querySelector('#audioPlayer'),
  visualizer: document.querySelector('#visualizer')
}

const state = {
  stations: [],
  filteredStations: [],
  selectedId: null,
  sourceLabel: 'api',
  analyser: null,
  animationId: null,
  audioContext: null,
  mediaSource: null
}

function normalizeStations(rawStations) {
  const uniqueByUrl = new Map()

  rawStations.forEach((station) => {
    const streamUrl = station.url_resolved || station.url

    if (!streamUrl) {
      return
    }

    const normalized = {
      id: station.stationuuid || streamUrl,
      name: station.name?.trim() || 'Unknown Station',
      streamUrl,
      favicon: station.favicon || '',
      bitrate: Number(station.bitrate) || 0,
      language: (station.language || 'Unknown').trim(),
      tags: (station.tags || '').toLowerCase(),
      votes: Number(station.votes) || 0
    }

    if (!uniqueByUrl.has(streamUrl)) {
      uniqueByUrl.set(streamUrl, normalized)
    }
  })

  return [...uniqueByUrl.values()].sort((a, b) => b.votes - a.votes || b.bitrate - a.bitrate)
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message
  elements.statusMessage.classList.toggle('error', isError)
}

function renderLanguageOptions(stations) {
  const languages = [...new Set(stations.map((station) => station.language).filter(Boolean))].sort()

  elements.languageFilter.innerHTML = '<option value="all">All languages</option>'

  languages.forEach((language) => {
    const option = document.createElement('option')
    option.value = language.toLowerCase()
    option.textContent = language
    elements.languageFilter.appendChild(option)
  })
}

function renderStations() {
  if (!state.filteredStations.length) {
    elements.stationList.innerHTML = '<li class="empty">No stations match your filter.</li>'
    return
  }

  elements.stationList.innerHTML = state.filteredStations
    .map((station) => {
      const active = station.id === state.selectedId ? 'active' : ''
      const bitrate = station.bitrate ? `${station.bitrate} kbps` : 'Unknown bitrate'

      return `
        <li>
          <button class="station-card ${active}" type="button" data-id="${station.id}">
            <div class="station-top">
              <img src="${station.favicon || '/favicon.svg'}" alt="" loading="lazy" />
              <div>
                <h3>${station.name}</h3>
                <p>${station.language}</p>
              </div>
            </div>
            <p class="chip-row">
              <span class="chip">${bitrate}</span>
              ${station.tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
                .slice(0, 2)
                .map((tag) => `<span class="chip">${tag}</span>`)
                .join('')}
            </p>
          </button>
        </li>
      `
    })
    .join('')
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase()
  const language = elements.languageFilter.value

  state.filteredStations = state.stations.filter((station) => {
    const languageMatch = language === 'all' || station.language.toLowerCase() === language

    if (!languageMatch) {
      return false
    }

    if (!query) {
      return true
    }

    return [station.name, station.language, station.tags].join(' ').toLowerCase().includes(query)
  })

  if (state.selectedId && !state.filteredStations.some((station) => station.id === state.selectedId)) {
    state.selectedId = null
    elements.playPauseBtn.disabled = true
    elements.audio.pause()
    elements.audio.removeAttribute('src')
    updatePlayerMeta(null)
  }

  renderStations()
}

function updatePlayerMeta(station) {
  if (!station) {
    elements.stationName.textContent = 'Choose a station'
    elements.stationMeta.textContent = 'No stream selected'
    elements.stationLogo.src = '/favicon.svg'
    elements.stationLogo.alt = ''
    return
  }

  elements.stationName.textContent = station.name
  elements.stationMeta.textContent = `${station.language} • ${station.bitrate ? `${station.bitrate} kbps` : 'Bitrate n/a'}`
  elements.stationLogo.src = station.favicon || '/favicon.svg'
  elements.stationLogo.alt = `${station.name} logo`
}

async function chooseStation(stationId) {
  const station = state.stations.find((item) => item.id === stationId)

  if (!station) {
    return
  }

  state.selectedId = station.id
  renderStations()
  updatePlayerMeta(station)

  elements.audio.src = station.streamUrl
  elements.playPauseBtn.disabled = false

  try {
    await elements.audio.play()
    elements.playPauseBtn.textContent = 'Pause'
    setStatus(`Streaming from ${state.sourceLabel === 'api' ? 'Radio Browser API' : 'fallback list'}.`)
    setupVisualizer()
  } catch {
    elements.playPauseBtn.textContent = 'Play'
    setStatus('Tap play to start this stream. Some browsers block autoplay.', true)
  }
}

function setupVisualizer() {
  if (state.audioContext) {
    if (state.audioContext.state === 'suspended') {
      state.audioContext.resume()
    }
    return
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  if (!AudioContextClass) {
    return
  }

  state.audioContext = new AudioContextClass()
  state.analyser = state.audioContext.createAnalyser()
  state.analyser.fftSize = 128
  state.mediaSource = state.audioContext.createMediaElementSource(elements.audio)
  state.mediaSource.connect(state.analyser)
  state.analyser.connect(state.audioContext.destination)

  drawVisualizer()
}

function drawVisualizer() {
  if (!state.analyser) {
    return
  }

  const ctx = elements.visualizer.getContext('2d')
  const bufferLength = state.analyser.frequencyBinCount
  const dataArray = new Uint8Array(bufferLength)

  const paint = () => {
    state.animationId = window.requestAnimationFrame(paint)
    state.analyser.getByteFrequencyData(dataArray)

    ctx.clearRect(0, 0, elements.visualizer.width, elements.visualizer.height)
    ctx.fillStyle = '#0a0f1f'
    ctx.fillRect(0, 0, elements.visualizer.width, elements.visualizer.height)

    const barWidth = (elements.visualizer.width / bufferLength) * 1.9
    let x = 0

    dataArray.forEach((value) => {
      const barHeight = (value / 255) * elements.visualizer.height
      const hue = 165 + value / 4
      ctx.fillStyle = `hsl(${hue}, 90%, 58%)`
      ctx.fillRect(x, elements.visualizer.height - barHeight, barWidth, barHeight)
      x += barWidth + 1
    })
  }

  paint()
}

async function fetchStations() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 9000)

  try {
    const response = await fetch(API_ENDPOINT, { signal: controller.signal })

    if (!response.ok) {
      throw new Error('API request failed')
    }

    const data = await response.json()
    const normalized = normalizeStations(data)

    if (!normalized.length) {
      throw new Error('No stations in API response')
    }

    state.stations = normalized
    state.sourceLabel = 'api'
    setStatus(`Loaded ${normalized.length} stations from Radio Browser API.`)
  } catch {
    state.stations = normalizeStations(CURATED_FALLBACK)
    state.sourceLabel = 'fallback'
    setStatus('Radio Browser is unavailable. Showing curated fallback stations.', true)
  } finally {
    window.clearTimeout(timeout)
  }

  renderLanguageOptions(state.stations)
  applyFilters()
}

elements.searchInput.addEventListener('input', applyFilters)
elements.languageFilter.addEventListener('change', applyFilters)

elements.stationList.addEventListener('click', (event) => {
  const card = event.target.closest('.station-card')

  if (!card) {
    return
  }

  chooseStation(card.dataset.id)
})

elements.playPauseBtn.addEventListener('click', async () => {
  if (!state.selectedId) {
    return
  }

  if (elements.audio.paused) {
    try {
      await elements.audio.play()
      setupVisualizer()
      elements.playPauseBtn.textContent = 'Pause'
    } catch {
      setStatus('Playback failed. Try selecting another stream.', true)
    }
    return
  }

  elements.audio.pause()
  elements.playPauseBtn.textContent = 'Play'
})

elements.volumeSlider.addEventListener('input', () => {
  elements.audio.volume = Number(elements.volumeSlider.value)
})

elements.audio.addEventListener('error', () => {
  setStatus('This stream cannot be played right now. Choose another station.', true)
  elements.playPauseBtn.textContent = 'Play'
})

elements.audio.addEventListener('play', () => {
  elements.playPauseBtn.textContent = 'Pause'
})

elements.audio.addEventListener('pause', () => {
  elements.playPauseBtn.textContent = 'Play'
})

updatePlayerMeta(null)
elements.audio.volume = Number(elements.volumeSlider.value)

fetchStations()
