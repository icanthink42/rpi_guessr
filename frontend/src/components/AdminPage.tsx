import { useState, useEffect, useRef } from 'react'
import { GoogleLogin, googleLogout } from '@react-oauth/google'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import { API_BASE, GOOGLE_CLIENT_ID } from '../config'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Orange marker for user guesses
const guessIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml,' + encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
      <path fill="#f97316" stroke="#c2410c" stroke-width="1" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/>
    </svg>
  `),
  iconSize: [24, 36],
  iconAnchor: [12, 36],
})

const RPI_CENTER: [number, number] = [42.7302, -73.6788]

interface LatLng {
  lat: number
  lng: number
}

// Places a marker wherever the map is clicked
function LocationPicker({ location, onPick }: { location: LatLng | null; onPick: (location: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return location ? (
    <Marker position={[location.lat, location.lng]} icon={markerIcon} />
  ) : null
}

interface Photo {
  id: string
  photo_url: string
  longitude: number
  latitude: number
  created_at: string
}

interface Guess {
  id: string
  longitude: number
  latitude: number
  distance_km: number
  created_at: string
}

interface LocationReport {
  id: string
  photo_id: string
  photo_url: string
  current_longitude: number
  current_latitude: number
  suggested_longitude: number
  suggested_latitude: number
  comment?: string
  status: string
  created_at: string
}

interface GameEntry {
  id: string
  player_name: string
  mode: number
  total_score: number
  completed_at: string
}

interface UploadProgress {
  current: number
  total: number
  succeeded: number
  failed: string[]
}

// A selected photo with no GPS data, waiting for a location to be placed on the map
interface PendingPhoto {
  file: File
  previewUrl: string
}

interface AdminPageProps {
  onBack: () => void
}

export default function AdminPage({ onBack }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'photos' | 'reports' | 'leaderboard'>('photos')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('admin_token'))
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem('admin_email'))
  const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null)
  const [editLocation, setEditLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [photoGuesses, setPhotoGuesses] = useState<Guess[]>([])
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Photos without GPS data, placed on the map one at a time
  const [locationQueue, setLocationQueue] = useState<PendingPhoto[]>([])
  const [queueLocation, setQueueLocation] = useState<LatLng | null>(null)
  const [uploadingQueued, setUploadingQueued] = useState(false)

  // Reports state
  const [reports, setReports] = useState<LocationReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reviewingReport, setReviewingReport] = useState<LocationReport | null>(null)
  const [processingReport, setProcessingReport] = useState<string | null>(null)

  // Leaderboard/Games state
  const [games, setGames] = useState<GameEntry[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [editingGame, setEditingGame] = useState<GameEntry | null>(null)
  const [editingName, setEditingName] = useState('')
  const [processingGame, setProcessingGame] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Skip auth if no client ID configured (local dev)
  const authRequired = GOOGLE_CLIENT_ID !== ''
  const isAuthenticated = !authRequired || token !== null

  const handleLoginSuccess = (credentialResponse: { credential?: string }) => {
    if (credentialResponse.credential) {
      // Decode JWT to get email (just for display, backend will verify)
      const payload = JSON.parse(atob(credentialResponse.credential.split('.')[1]))

      setToken(credentialResponse.credential)
      setUserEmail(payload.email)
      localStorage.setItem('admin_token', credentialResponse.credential)
      localStorage.setItem('admin_email', payload.email)
    }
  }

  const logout = () => {
    googleLogout()
    setToken(null)
    setUserEmail(null)
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_email')
  }

  const getAuthHeaders = (): HeadersInit => {
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
    return {}
  }

  const fetchPhotos = async () => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/photos`, {
        headers: getAuthHeaders()
      })
      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }
      if (response.ok) {
        const data = await response.json()
        setPhotos(Array.isArray(data) ? data : [])
      } else {
        console.error('Failed to fetch photos:', response.status)
      }
    } catch (error) {
      console.error('Failed to fetch photos:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPhotos()
  }, [isAuthenticated])

  const fetchReports = async () => {
    if (!isAuthenticated) return

    setReportsLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/reports?status=pending`, {
        headers: getAuthHeaders()
      })
      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }
      if (response.ok) {
        const data = await response.json()
        setReports(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Failed to fetch reports:', error)
    } finally {
      setReportsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'reports') {
      fetchReports()
    }
  }, [activeTab, isAuthenticated])

  const handleAcceptReport = async (reportId: string) => {
    setProcessingReport(reportId)
    try {
      const response = await fetch(`${API_BASE}/api/reports/${reportId}/accept`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setReports(reports.filter(r => r.id !== reportId))
        setReviewingReport(null)
        fetchPhotos() // Refresh photos to get updated location
      } else {
        alert('Failed to accept report')
      }
    } catch (error) {
      console.error('Accept report failed:', error)
      alert('Failed to accept report')
    } finally {
      setProcessingReport(null)
    }
  }

  const handleRejectReport = async (reportId: string) => {
    setProcessingReport(reportId)
    try {
      const response = await fetch(`${API_BASE}/api/reports/${reportId}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setReports(reports.filter(r => r.id !== reportId))
        setReviewingReport(null)
      } else {
        alert('Failed to reject report')
      }
    } catch (error) {
      console.error('Reject report failed:', error)
      alert('Failed to reject report')
    } finally {
      setProcessingReport(null)
    }
  }

  // Games/Leaderboard handlers
  const fetchGames = async () => {
    if (!isAuthenticated) return

    setGamesLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/games`, {
        headers: getAuthHeaders()
      })
      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }
      if (response.ok) {
        const data = await response.json()
        setGames(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      console.error('Failed to fetch games:', error)
    } finally {
      setGamesLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchGames()
    }
  }, [activeTab, isAuthenticated])

  const handleRenameGame = async () => {
    if (!editingGame || !editingName.trim()) return

    setProcessingGame(editingGame.id)
    try {
      const response = await fetch(`${API_BASE}/api/games/${editingGame.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ player_name: editingName.trim() }),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setGames(games.map(g =>
          g.id === editingGame.id ? { ...g, player_name: editingName.trim() } : g
        ))
        setEditingGame(null)
        setEditingName('')
      } else {
        alert('Failed to rename')
      }
    } catch (error) {
      console.error('Rename failed:', error)
      alert('Failed to rename')
    } finally {
      setProcessingGame(null)
    }
  }

  const handleDeleteGame = async (gameId: string) => {
    setProcessingGame(gameId)
    try {
      const response = await fetch(`${API_BASE}/api/games/${gameId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setGames(games.filter(g => g.id !== gameId))
        setDeleteConfirm(null)
      } else {
        alert('Failed to delete')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Failed to delete')
    } finally {
      setProcessingGame(null)
    }
  }

  // Uploads a photo, using its GPS metadata unless a location is given
  const uploadPhoto = (file: File, location?: LatLng) => {
    const formData = new FormData()
    formData.append('photo', file)
    if (location) {
      formData.append('latitude', String(location.lat))
      formData.append('longitude', String(location.lng))
    }

    return fetch(`${API_BASE}/api/photos`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    })
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const total = files.length
    setProgress({ current: 0, total, succeeded: 0, failed: [] })

    let succeeded = 0
    const failed: string[] = []
    const missingLocation: PendingPhoto[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setProgress(prev => prev ? { ...prev, current: i + 1 } : null)

      try {
        const response = await uploadPhoto(file)

        if (response.status === 401 || response.status === 403) {
          logout()
          return
        }

        if (!response.ok) {
          const data = await response.json()
          if (data.code === 'missing_location') {
            missingLocation.push({ file, previewUrl: URL.createObjectURL(file) })
            continue
          }
          throw new Error(data.error || 'Upload failed')
        }

        succeeded++
      } catch (error) {
        console.error(`Upload failed for ${file.name}:`, error)
        const reason = error instanceof Error ? error.message : 'Unknown error'
        failed.push(`${file.name}: ${reason}`)
      }

      setProgress(prev => prev ? { ...prev, succeeded, failed } : null)
    }

    setProgress(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    fetchPhotos()

    if (failed.length > 0) {
      alert(`Uploaded ${succeeded}/${total} photos.\n\nFailed:\n${failed.join('\n')}`)
    }

    if (missingLocation.length > 0) {
      setQueueLocation(null)
      setLocationQueue(missingLocation)
    }
  }

  // Drops the current photo from the location queue and moves on to the next one
  const advanceLocationQueue = () => {
    if (locationQueue.length > 0) {
      URL.revokeObjectURL(locationQueue[0].previewUrl)
    }
    setLocationQueue(locationQueue.slice(1))
    setQueueLocation(null)
  }

  const cancelLocationQueue = () => {
    locationQueue.forEach(pending => URL.revokeObjectURL(pending.previewUrl))
    setLocationQueue([])
    setQueueLocation(null)
  }

  const uploadQueuedPhoto = async () => {
    const pending = locationQueue[0]
    if (!pending || !queueLocation) return

    setUploadingQueued(true)
    try {
      const response = await uploadPhoto(pending.file, queueLocation)

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Upload failed')
      }

      advanceLocationQueue()
      fetchPhotos()
    } catch (error) {
      console.error(`Upload failed for ${pending.file.name}:`, error)
      const reason = error instanceof Error ? error.message : 'Unknown error'
      alert(`Failed to upload ${pending.file.name}: ${reason}`)
    } finally {
      setUploadingQueued(false)
    }
  }

  const handleDelete = async (photoId: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return

    setDeleting(photoId)
    try {
      const response = await fetch(`${API_BASE}/api/photos/${photoId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setPhotos(photos.filter(p => p.id !== photoId))
      } else {
        alert('Failed to delete photo')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('Failed to delete photo')
    } finally {
      setDeleting(null)
    }
  }

  const uploading = progress !== null

  const openEditLocation = async (photo: Photo) => {
    setEditingPhoto(photo)
    setEditLocation({ lat: photo.latitude, lng: photo.longitude })
    setPhotoGuesses([])

    // Fetch guesses for this photo
    try {
      const response = await fetch(`${API_BASE}/api/photos/${photo.id}/guesses`, {
        headers: getAuthHeaders()
      })
      if (response.ok) {
        const guesses = await response.json()
        setPhotoGuesses(guesses)
      }
    } catch (error) {
      console.error('Failed to fetch guesses:', error)
    }
  }

  const saveLocation = async () => {
    if (!editingPhoto || !editLocation) return

    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/api/photos/${editingPhoto.id}/location`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          latitude: editLocation.lat,
          longitude: editLocation.lng,
        }),
      })

      if (response.status === 401 || response.status === 403) {
        logout()
        return
      }

      if (response.ok) {
        setPhotos(photos.map(p =>
          p.id === editingPhoto.id
            ? { ...p, latitude: editLocation.lat, longitude: editLocation.lng }
            : p
        ))
        setEditingPhoto(null)
        setEditLocation(null)
        setPhotoGuesses([])
      } else {
        alert('Failed to update location')
      }
    } catch (error) {
      console.error('Update failed:', error)
      alert('Failed to update location')
    } finally {
      setSaving(false)
    }
  }

  // Show login screen if auth is required and not authenticated
  if (authRequired && !isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 md:gap-8 p-4">
        <h1 className="text-2xl md:text-4xl font-bold text-red-500">Admin Login</h1>
        <p className="text-gray-400 text-sm md:text-base text-center">Sign in with your organization account</p>
        <GoogleLogin
          onSuccess={handleLoginSuccess}
          onError={() => alert('Login failed')}
        />
        <button
          onClick={onBack}
          className="text-red-400 hover:text-red-300 text-sm md:text-base"
        >
          Back to Menu
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 md:mb-8">
          <h1 className="text-2xl md:text-4xl font-bold text-red-500">Admin</h1>
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            {userEmail && (
              <span className="text-gray-400 text-xs md:text-sm">{userEmail}</span>
            )}
            {authRequired && (
              <button
                onClick={logout}
                className="px-3 py-1.5 md:px-4 md:py-2 text-xs md:text-sm text-gray-400 border border-gray-600 rounded
                           hover:bg-gray-800 transition-colors"
              >
                Sign Out
              </button>
            )}
            <button
              onClick={onBack}
              className="px-4 py-1.5 md:px-6 md:py-2 text-sm md:text-base text-red-400 border-2 border-red-600 rounded-lg
                         hover:bg-red-600/20 transition-colors"
            >
              Back
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('photos')}
            className={`px-4 py-2 text-sm md:text-base font-medium transition-colors
                       ${activeTab === 'photos'
                         ? 'text-red-500 border-b-2 border-red-500'
                         : 'text-gray-400 hover:text-white'}`}
          >
            Photos
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2 text-sm md:text-base font-medium transition-colors relative
                       ${activeTab === 'reports'
                         ? 'text-red-500 border-b-2 border-red-500'
                         : 'text-gray-400 hover:text-white'}`}
          >
            Reports
            {reports.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {reports.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`px-4 py-2 text-sm md:text-base font-medium transition-colors
                       ${activeTab === 'leaderboard'
                         ? 'text-red-500 border-b-2 border-red-500'
                         : 'text-gray-400 hover:text-white'}`}
          >
            Leaderboard
          </button>
        </div>

        {/* Photos Tab */}
        {activeTab === 'photos' && (
          <>
            <div className="mb-6 md:mb-8">
              <label className="cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={handleUpload}
                  disabled={uploading}
                  className="hidden"
                />
                <span className={`inline-block px-6 py-2.5 md:px-8 md:py-3 text-base md:text-lg font-medium text-white bg-red-600
                                rounded-lg hover:bg-red-500 transition-colors
                                ${uploading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}>
                  {progress
                    ? `Uploading ${progress.current}/${progress.total}...`
                    : 'Upload Photos'}
                </span>
              </label>
              <p className="text-gray-500 text-xs md:text-sm mt-2">
                Select JPG, PNG, or WebP files. Photos without GPS data can be placed on the map after selecting.
              </p>
            </div>

            {loading ? (
          <p className="text-gray-400">Loading photos...</p>
        ) : photos.length === 0 ? (
          <p className="text-gray-400">No photos uploaded yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4">
            {photos.map(photo => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.photo_url}
                  alt="Uploaded photo"
                  className="w-full h-32 md:h-48 object-cover rounded-lg"
                />
                {/* Mobile: always show buttons at bottom */}
                <div className="md:hidden absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent
                                rounded-b-lg p-2 flex gap-1">
                  <button
                    onClick={() => openEditLocation(photo)}
                    className="flex-1 py-1.5 bg-blue-600 text-white rounded
                               text-xs font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(photo.id)}
                    disabled={deleting === photo.id}
                    className="flex-1 py-1.5 bg-red-600 text-white rounded
                               text-xs font-medium disabled:opacity-50"
                  >
                    {deleting === photo.id ? '...' : 'Delete'}
                  </button>
                </div>
                {/* Desktop: show on hover */}
                <div className="hidden md:flex absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100
                                transition-opacity rounded-lg flex-col justify-between p-3">
                  <div className="text-xs text-gray-300">
                    <p>Lat: {photo.latitude.toFixed(6)}</p>
                    <p>Lon: {photo.longitude.toFixed(6)}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => openEditLocation(photo)}
                      className="w-full py-2 bg-blue-600 text-white rounded
                                 hover:bg-blue-500 transition-colors text-sm"
                    >
                      Edit Location
                    </button>
                    <button
                      onClick={() => handleDelete(photo.id)}
                      disabled={deleting === photo.id}
                      className="w-full py-2 bg-red-600 text-white rounded
                                 hover:bg-red-500 transition-colors text-sm
                                 disabled:opacity-50"
                    >
                      {deleting === photo.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

            <p className="text-gray-500 text-xs md:text-sm mt-6 md:mt-8">
              Total: {photos.length} photo{photos.length !== 1 ? 's' : ''}
            </p>
          </>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div>
            {reportsLoading ? (
              <p className="text-gray-400">Loading reports...</p>
            ) : reports.length === 0 ? (
              <p className="text-gray-400">No pending reports.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reports.map(report => (
                  <div key={report.id} className="bg-gray-800 rounded-lg overflow-hidden">
                    <img
                      src={report.photo_url}
                      alt="Reported photo"
                      className="w-full h-40 object-cover"
                    />
                    <div className="p-4">
                      <p className="text-gray-300 text-sm mb-2">
                        <span className="text-gray-500">Current:</span>{' '}
                        {report.current_latitude.toFixed(5)}, {report.current_longitude.toFixed(5)}
                      </p>
                      <p className="text-green-400 text-sm mb-2">
                        <span className="text-gray-500">Suggested:</span>{' '}
                        {report.suggested_latitude.toFixed(5)}, {report.suggested_longitude.toFixed(5)}
                      </p>
                      {report.comment && (
                        <p className="text-gray-400 text-sm italic mb-3">"{report.comment}"</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setReviewingReport(report)}
                          className="flex-1 py-2 bg-blue-600 text-white rounded
                                     hover:bg-blue-500 transition-colors text-sm"
                        >
                          Review
                        </button>
                        <button
                          onClick={() => handleAcceptReport(report.id)}
                          disabled={processingReport === report.id}
                          className="flex-1 py-2 bg-green-600 text-white rounded
                                     hover:bg-green-500 transition-colors text-sm disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRejectReport(report.id)}
                          disabled={processingReport === report.id}
                          className="flex-1 py-2 bg-red-600 text-white rounded
                                     hover:bg-red-500 transition-colors text-sm disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Leaderboard Tab */}
        {activeTab === 'leaderboard' && (
          <div>
            {gamesLoading ? (
              <p className="text-gray-400">Loading games...</p>
            ) : games.length === 0 ? (
              <p className="text-gray-400">No completed games yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-3 px-4 text-gray-400 font-medium">Player</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Mode</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Score</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Date</th>
                      <th className="py-3 px-4 text-gray-400 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map(game => (
                      <tr key={game.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-3 px-4 text-white">{game.player_name}</td>
                        <td className="py-3 px-4 text-gray-300">{game.mode} rounds</td>
                        <td className="py-3 px-4 text-yellow-400 font-medium">{game.total_score.toLocaleString()}</td>
                        <td className="py-3 px-4 text-gray-400 text-sm">
                          {new Date(game.completed_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingGame(game)
                                setEditingName(game.player_name)
                              }}
                              className="px-3 py-1 bg-blue-600 text-white rounded text-sm
                                         hover:bg-blue-500 transition-colors"
                            >
                              Rename
                            </button>
                            {deleteConfirm === game.id ? (
                              <>
                                <button
                                  onClick={() => handleDeleteGame(game.id)}
                                  disabled={processingGame === game.id}
                                  className="px-3 py-1 bg-red-600 text-white rounded text-sm
                                             hover:bg-red-500 transition-colors disabled:opacity-50"
                                >
                                  {processingGame === game.id ? '...' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="px-3 py-1 bg-gray-600 text-white rounded text-sm
                                             hover:bg-gray-500 transition-colors"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(game.id)}
                                className="px-3 py-1 bg-red-600 text-white rounded text-sm
                                           hover:bg-red-500 transition-colors"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rename Game Modal */}
      {editingGame && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-lg w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-white mb-4">Rename Player</h2>
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-700
                         focus:border-red-500 focus:outline-none mb-4"
              maxLength={50}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingGame(null)
                  setEditingName('')
                }}
                className="px-4 py-2 text-gray-400 border border-gray-600 rounded-lg
                           hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameGame}
                disabled={processingGame === editingGame.id || !editingName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg
                           hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {processingGame === editingGame.id ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Place Location Modal (photos uploaded without GPS data) */}
      {locationQueue.length > 0 && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 md:p-4">
          <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[95vh] md:h-[90vh] flex flex-col">
            <div className="p-3 md:p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg md:text-xl font-bold text-white">
                Set Location
                {locationQueue.length > 1 && (
                  <span className="text-gray-400 font-normal text-sm md:text-base ml-2">
                    ({locationQueue.length} remaining)
                  </span>
                )}
              </h2>
              <button
                onClick={cancelLocationQueue}
                disabled={uploadingQueued}
                className="text-gray-400 hover:text-white text-2xl leading-none disabled:opacity-50"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 p-3 md:p-4 overflow-hidden min-h-0">
              <div className="md:w-1/3 flex-shrink-0">
                <img
                  src={locationQueue[0].previewUrl}
                  alt="Photo needing a location"
                  className="w-full max-h-32 md:max-h-[50vh] object-contain rounded-lg bg-black"
                />
                <div className="mt-2 md:mt-4 text-xs md:text-sm text-gray-300">
                  <p className="text-white break-all">{locationQueue[0].file.name}</p>
                  <p className="text-gray-400 mt-1">
                    This photo has no GPS data. Click the map where it was taken.
                  </p>
                  {queueLocation && (
                    <p className="text-green-400 mt-2">
                      Location: {queueLocation.lat.toFixed(4)}, {queueLocation.lng.toFixed(4)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-[200px] md:min-h-[400px] rounded-lg overflow-hidden">
                <MapContainer
                  center={RPI_CENTER}
                  zoom={16}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <LocationPicker location={queueLocation} onPick={setQueueLocation} />
                </MapContainer>
              </div>
            </div>

            <div className="p-3 md:p-4 border-t border-gray-700 flex justify-end gap-2 md:gap-4">
              <button
                onClick={advanceLocationQueue}
                disabled={uploadingQueued}
                className="px-4 py-2 md:px-6 text-sm md:text-base text-gray-400 border border-gray-600 rounded-lg
                           hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Skip
              </button>
              <button
                onClick={uploadQueuedPhoto}
                disabled={uploadingQueued || !queueLocation}
                className="px-4 py-2 md:px-6 text-sm md:text-base bg-green-600 text-white rounded-lg
                           hover:bg-green-500 transition-colors disabled:opacity-50"
              >
                {uploadingQueued ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Location Modal */}
      {editingPhoto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 md:p-4">
          <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[95vh] md:h-[90vh] flex flex-col">
            <div className="p-3 md:p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg md:text-xl font-bold text-white">Edit Location</h2>
              <button
                onClick={() => { setEditingPhoto(null); setEditLocation(null); setPhotoGuesses([]); }}
                className="text-gray-400 hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 p-3 md:p-4 overflow-hidden min-h-0">
              <div className="md:w-1/3 flex-shrink-0">
                <img
                  src={editingPhoto.photo_url}
                  alt="Photo being edited"
                  className="w-full h-32 md:h-48 object-cover rounded-lg"
                />
                <div className="mt-2 md:mt-4 text-xs md:text-sm text-gray-300">
                  <p>Current: {editingPhoto.latitude.toFixed(4)}, {editingPhoto.longitude.toFixed(4)}</p>
                  {editLocation && (
                    <p className="text-green-400">
                      New: {editLocation.lat.toFixed(4)}, {editLocation.lng.toFixed(4)}
                    </p>
                  )}
                  {photoGuesses.length > 0 && (
                    <p className="text-orange-400 mt-2">
                      {photoGuesses.length} guess{photoGuesses.length !== 1 ? 'es' : ''} (orange pins)
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-[200px] md:min-h-[400px] rounded-lg overflow-hidden">
                <MapContainer
                  center={[editingPhoto.latitude, editingPhoto.longitude]}
                  zoom={15}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <LocationPicker location={editLocation} onPick={setEditLocation} />
                  {photoGuesses.map(guess => (
                    <Marker
                      key={guess.id}
                      position={[guess.latitude, guess.longitude]}
                      icon={guessIcon}
                    />
                  ))}
                </MapContainer>
              </div>
            </div>

            <div className="p-3 md:p-4 border-t border-gray-700 flex justify-end gap-2 md:gap-4">
              <button
                onClick={() => { setEditingPhoto(null); setEditLocation(null); setPhotoGuesses([]); }}
                className="px-4 py-2 md:px-6 text-sm md:text-base text-gray-400 border border-gray-600 rounded-lg
                           hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLocation}
                disabled={saving || !editLocation}
                className="px-4 py-2 md:px-6 text-sm md:text-base bg-green-600 text-white rounded-lg
                           hover:bg-green-500 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Report Modal */}
      {reviewingReport && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-2 md:p-4">
          <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[95vh] md:h-[90vh] flex flex-col">
            <div className="p-3 md:p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-lg md:text-xl font-bold text-white">Review Report</h2>
              <button
                onClick={() => setReviewingReport(null)}
                className="text-gray-400 hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 p-3 md:p-4 overflow-hidden min-h-0">
              <div className="md:w-1/3 flex-shrink-0">
                <img
                  src={reviewingReport.photo_url}
                  alt="Reported photo"
                  className="w-full h-32 md:h-48 object-cover rounded-lg"
                />
                <div className="mt-2 md:mt-4 text-xs md:text-sm text-gray-300 space-y-2">
                  <p>
                    <span className="text-gray-500">Current location:</span><br/>
                    <span className="text-blue-400">{reviewingReport.current_latitude.toFixed(6)}, {reviewingReport.current_longitude.toFixed(6)}</span>
                  </p>
                  <p>
                    <span className="text-gray-500">Suggested location:</span><br/>
                    <span className="text-green-400">{reviewingReport.suggested_latitude.toFixed(6)}, {reviewingReport.suggested_longitude.toFixed(6)}</span>
                  </p>
                  {reviewingReport.comment && (
                    <p>
                      <span className="text-gray-500">Comment:</span><br/>
                      <span className="italic">"{reviewingReport.comment}"</span>
                    </p>
                  )}
                </div>
                <div className="mt-4 text-xs text-gray-500">
                  <p><span className="inline-block w-3 h-3 bg-blue-500 rounded-full mr-2"></span>Blue = Current</p>
                  <p><span className="inline-block w-3 h-3 bg-green-500 rounded-full mr-2"></span>Green = Suggested</p>
                </div>
              </div>

              <div className="flex-1 min-h-[200px] md:min-h-[400px] rounded-lg overflow-hidden">
                <MapContainer
                  center={[reviewingReport.suggested_latitude, reviewingReport.suggested_longitude]}
                  zoom={17}
                  className="h-full w-full"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {/* Current location - blue */}
                  <Marker
                    position={[reviewingReport.current_latitude, reviewingReport.current_longitude]}
                    icon={new L.Icon({
                      iconUrl: 'data:image/svg+xml,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
                          <path fill="#3b82f6" stroke="#1d4ed8" stroke-width="1" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/>
                        </svg>
                      `),
                      iconSize: [24, 36],
                      iconAnchor: [12, 36],
                    })}
                  />
                  {/* Suggested location - green */}
                  <Marker
                    position={[reviewingReport.suggested_latitude, reviewingReport.suggested_longitude]}
                    icon={new L.Icon({
                      iconUrl: 'data:image/svg+xml,' + encodeURIComponent(`
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
                          <path fill="#22c55e" stroke="#15803d" stroke-width="1" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/>
                        </svg>
                      `),
                      iconSize: [24, 36],
                      iconAnchor: [12, 36],
                    })}
                  />
                </MapContainer>
              </div>
            </div>

            <div className="p-3 md:p-4 border-t border-gray-700 flex justify-end gap-2 md:gap-4">
              <button
                onClick={() => setReviewingReport(null)}
                className="px-4 py-2 md:px-6 text-sm md:text-base text-gray-400 border border-gray-600 rounded-lg
                           hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRejectReport(reviewingReport.id)}
                disabled={processingReport === reviewingReport.id}
                className="px-4 py-2 md:px-6 text-sm md:text-base bg-red-600 text-white rounded-lg
                           hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => handleAcceptReport(reviewingReport.id)}
                disabled={processingReport === reviewingReport.id}
                className="px-4 py-2 md:px-6 text-sm md:text-base bg-green-600 text-white rounded-lg
                           hover:bg-green-500 transition-colors disabled:opacity-50"
              >
                Accept & Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
