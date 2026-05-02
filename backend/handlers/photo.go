package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"rpi_guessr/backend/database"
	"rpi_guessr/backend/models"
	"rpi_guessr/backend/storage"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rwcarlsen/goexif/exif"
)

const earthRadiusKm = 6371.0

func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusKm * c
}

// CalculatePoints converts distance to points using exponential decay.
// Within 15m: 5000 points, at 500m: 1 point, asymptotic decay between.
func CalculatePoints(distanceKm float64) int {
	meters := distanceKm * 1000
	if meters <= 15 {
		return 5000
	}
	// Exponential decay: 5000 * e^(-k * (meters - 15)) where k = ln(5000) / 485
	k := math.Log(5000) / (500 - 15)
	points := 5000 * math.Exp(-k*(meters-15))
	result := int(math.Round(points))
	if result < 0 {
		return 0
	}
	return result
}

type PhotoHandler struct {
	db      *database.PostgresDB
	storage *storage.S3Storage
}

func NewPhotoHandler(db *database.PostgresDB, storage *storage.S3Storage) *PhotoHandler {
	return &PhotoHandler{
		db:      db,
		storage: storage,
	}
}

func (h *PhotoHandler) GetRandomPhoto(c *gin.Context) {
	query := `SELECT id, s3_key FROM photos ORDER BY RANDOM() LIMIT 1`

	var photoID, s3Key string
	err := h.db.Pool.QueryRow(context.Background(), query).Scan(&photoID, &s3Key)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No photos found"})
		return
	}

	c.JSON(http.StatusOK, models.RandomPhotoResponse{
		ID:       photoID,
		PhotoURL: h.storage.GetURL(s3Key),
	})
}

func (h *PhotoHandler) UploadPhoto(c *gin.Context) {
	file, header, err := c.Request.FormFile("photo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "photo file is required"})
		return
	}
	defer file.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read photo"})
		return
	}
	fileBytes := buf.Bytes()

	exifData, err := exif.Decode(bytes.NewReader(fileBytes))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read photo metadata"})
		return
	}

	lat, lon, err := exifData.LatLong()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "photo does not contain GPS location data"})
		return
	}

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	s3Key := fmt.Sprintf("photos/%s-%s", uuid.New().String(), header.Filename)

	err = h.storage.Upload(c.Request.Context(), s3Key, bytes.NewReader(fileBytes), contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upload photo"})
		return
	}

	query := `
		INSERT INTO photos (s3_key, s3_bucket, longitude, latitude, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`

	var photoID string
	now := time.Now()
	err = h.db.Pool.QueryRow(
		context.Background(),
		query,
		s3Key,
		h.storage.Bucket(),
		lon,
		lat,
		now,
		now,
	).Scan(&photoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save photo metadata"})
		return
	}

	c.JSON(http.StatusCreated, models.RandomPhotoResponse{
		ID:       photoID,
		PhotoURL: h.storage.GetURL(s3Key),
	})
}

func (h *PhotoHandler) SubmitGuess(c *gin.Context) {
	photoID := c.Param("id")

	var req models.GuessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	query := `SELECT longitude, latitude FROM photos WHERE id = $1`

	var actualLon, actualLat float64
	err := h.db.Pool.QueryRow(context.Background(), query, photoID).Scan(&actualLon, &actualLat)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Photo not found"})
		return
	}

	distanceKm := haversineDistance(req.Latitude, req.Longitude, actualLat, actualLon)

	// Store the guess in the database
	insertQuery := `
		INSERT INTO guesses (photo_id, guess_longitude, guess_latitude, distance_km, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err = h.db.Pool.Exec(context.Background(), insertQuery, photoID, req.Longitude, req.Latitude, distanceKm, time.Now())
	if err != nil {
		// Log but don't fail the request - guessing should still work
		fmt.Printf("Failed to store guess: %v\n", err)
	}

	// Fetch other guesses for this photo (excluding the one just made, limit to recent 50)
	guessQuery := `
		SELECT guess_longitude, guess_latitude
		FROM guesses
		WHERE photo_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`
	rows, _ := h.db.Pool.Query(context.Background(), guessQuery, photoID)
	defer rows.Close()

	var otherGuesses []models.Location
	for rows.Next() {
		var loc models.Location
		if err := rows.Scan(&loc.Longitude, &loc.Latitude); err == nil {
			otherGuesses = append(otherGuesses, loc)
		}
	}

	response := models.GuessResponse{
		DistanceKm:   distanceKm,
		Points:       CalculatePoints(distanceKm),
		OtherGuesses: otherGuesses,
	}
	response.ActualLocation.Longitude = actualLon
	response.ActualLocation.Latitude = actualLat

	c.JSON(http.StatusOK, response)
}

func (h *PhotoHandler) ListPhotos(c *gin.Context) {
	query := `SELECT id, s3_key, longitude, latitude, created_at FROM photos ORDER BY created_at DESC`

	rows, err := h.db.Pool.Query(context.Background(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch photos"})
		return
	}
	defer rows.Close()

	var photos []models.PhotoListItem
	for rows.Next() {
		var photo models.PhotoListItem
		var s3Key string
		if err := rows.Scan(&photo.ID, &s3Key, &photo.Longitude, &photo.Latitude, &photo.CreatedAt); err != nil {
			continue
		}
		photo.PhotoURL = h.storage.GetURL(s3Key)
		photos = append(photos, photo)
	}

	if photos == nil {
		photos = []models.PhotoListItem{}
	}

	c.JSON(http.StatusOK, photos)
}

func (h *PhotoHandler) GetPhotoGuesses(c *gin.Context) {
	photoID := c.Param("id")

	query := `SELECT id, guess_longitude, guess_latitude, distance_km, created_at FROM guesses WHERE photo_id = $1 ORDER BY created_at DESC`

	rows, err := h.db.Pool.Query(context.Background(), query, photoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch guesses"})
		return
	}
	defer rows.Close()

	type GuessItem struct {
		ID         string    `json:"id"`
		Longitude  float64   `json:"longitude"`
		Latitude   float64   `json:"latitude"`
		DistanceKm float64   `json:"distance_km"`
		CreatedAt  time.Time `json:"created_at"`
	}

	var guesses []GuessItem
	for rows.Next() {
		var g GuessItem
		if err := rows.Scan(&g.ID, &g.Longitude, &g.Latitude, &g.DistanceKm, &g.CreatedAt); err != nil {
			continue
		}
		guesses = append(guesses, g)
	}

	if guesses == nil {
		guesses = []GuessItem{}
	}

	c.JSON(http.StatusOK, guesses)
}

func (h *PhotoHandler) UpdatePhotoLocation(c *gin.Context) {
	photoID := c.Param("id")

	var req struct {
		Latitude  float64 `json:"latitude" binding:"required"`
		Longitude float64 `json:"longitude" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	query := `UPDATE photos SET latitude = $1, longitude = $2, updated_at = $3 WHERE id = $4`
	result, err := h.db.Pool.Exec(context.Background(), query, req.Latitude, req.Longitude, time.Now(), photoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update photo"})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Photo not found"})
		return
	}

	// Recalculate scores for all guesses on this photo
	if err := h.recalculateScoresForPhoto(photoID, req.Latitude, req.Longitude); err != nil {
		fmt.Printf("Warning: failed to recalculate scores: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Location updated"})
}

// recalculateScoresForPhoto recalculates distances and points for all guesses on a photo,
// then updates the total_score for any games that included those guesses
func (h *PhotoHandler) recalculateScoresForPhoto(photoID string, newLat, newLon float64) error {
	ctx := context.Background()

	// Get all guesses for this photo
	rows, err := h.db.Pool.Query(ctx, `
		SELECT id, guess_latitude, guess_longitude, game_id
		FROM guesses
		WHERE photo_id = $1
	`, photoID)
	if err != nil {
		return err
	}
	defer rows.Close()

	// Track which games need score updates
	affectedGames := make(map[string]bool)

	for rows.Next() {
		var guessID string
		var guessLat, guessLon float64
		var gameID *string

		if err := rows.Scan(&guessID, &guessLat, &guessLon, &gameID); err != nil {
			continue
		}

		// Recalculate distance and points
		newDistance := haversineDistance(guessLat, guessLon, newLat, newLon)
		newPoints := CalculatePoints(newDistance)

		// Update the guess
		_, err := h.db.Pool.Exec(ctx, `
			UPDATE guesses SET distance_km = $1, points = $2 WHERE id = $3
		`, newDistance, newPoints, guessID)
		if err != nil {
			fmt.Printf("Warning: failed to update guess %s: %v\n", guessID, err)
			continue
		}

		if gameID != nil {
			affectedGames[*gameID] = true
		}
	}

	// Update total_score for each affected game
	for gameID := range affectedGames {
		_, err := h.db.Pool.Exec(ctx, `
			UPDATE games SET total_score = (
				SELECT COALESCE(SUM(points), 0) FROM guesses WHERE game_id = $1
			) WHERE id = $1
		`, gameID)
		if err != nil {
			fmt.Printf("Warning: failed to update game %s score: %v\n", gameID, err)
		}
	}

	return nil
}

func (h *PhotoHandler) DeletePhoto(c *gin.Context) {
	photoID := c.Param("id")

	query := `SELECT s3_key FROM photos WHERE id = $1`
	var s3Key string
	err := h.db.Pool.QueryRow(context.Background(), query, photoID).Scan(&s3Key)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Photo not found"})
		return
	}

	if err := h.storage.Delete(c.Request.Context(), s3Key); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete photo from storage"})
		return
	}

	deleteQuery := `DELETE FROM photos WHERE id = $1`
	_, err = h.db.Pool.Exec(context.Background(), deleteQuery, photoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete photo metadata"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Photo deleted"})
}

// Location Report handlers

func (h *PhotoHandler) SubmitReport(c *gin.Context) {
	photoID := c.Param("id")

	var req models.CreateReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Verify photo exists
	var exists bool
	err := h.db.Pool.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM photos WHERE id = $1)", photoID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Photo not found"})
		return
	}

	query := `
		INSERT INTO location_reports (photo_id, suggested_longitude, suggested_latitude, comment, created_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`

	var comment *string
	if req.Comment != "" {
		comment = &req.Comment
	}

	var reportID string
	err = h.db.Pool.QueryRow(
		context.Background(),
		query,
		photoID,
		req.Longitude,
		req.Latitude,
		comment,
		time.Now(),
	).Scan(&reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit report"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"id": reportID, "message": "Report submitted"})
}

func (h *PhotoHandler) ListReports(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")

	query := `
		SELECT r.id, r.photo_id, p.s3_key, p.longitude, p.latitude,
		       r.suggested_longitude, r.suggested_latitude, r.comment, r.status, r.created_at
		FROM location_reports r
		JOIN photos p ON r.photo_id = p.id
		WHERE r.status = $1
		ORDER BY r.created_at DESC
	`

	rows, err := h.db.Pool.Query(context.Background(), query, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch reports"})
		return
	}
	defer rows.Close()

	var reports []models.ReportListItem
	for rows.Next() {
		var report models.ReportListItem
		var s3Key string
		if err := rows.Scan(
			&report.ID, &report.PhotoID, &s3Key,
			&report.CurrentLongitude, &report.CurrentLatitude,
			&report.SuggestedLongitude, &report.SuggestedLatitude,
			&report.Comment, &report.Status, &report.CreatedAt,
		); err != nil {
			continue
		}
		report.PhotoURL = h.storage.GetURL(s3Key)
		reports = append(reports, report)
	}

	if reports == nil {
		reports = []models.ReportListItem{}
	}

	c.JSON(http.StatusOK, reports)
}

func (h *PhotoHandler) AcceptReport(c *gin.Context) {
	reportID := c.Param("id")

	// Get report details
	var photoID string
	var suggestedLon, suggestedLat float64
	query := `SELECT photo_id, suggested_longitude, suggested_latitude FROM location_reports WHERE id = $1 AND status = 'pending'`
	err := h.db.Pool.QueryRow(context.Background(), query, reportID).Scan(&photoID, &suggestedLon, &suggestedLat)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Report not found or already resolved"})
		return
	}

	// Update photo location
	updatePhoto := `UPDATE photos SET longitude = $1, latitude = $2, updated_at = $3 WHERE id = $4`
	_, err = h.db.Pool.Exec(context.Background(), updatePhoto, suggestedLon, suggestedLat, time.Now(), photoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update photo location"})
		return
	}

	// Recalculate scores for all guesses on this photo
	if err := h.recalculateScoresForPhoto(photoID, suggestedLat, suggestedLon); err != nil {
		fmt.Printf("Warning: failed to recalculate scores: %v\n", err)
	}

	// Mark report as accepted
	updateReport := `UPDATE location_reports SET status = 'accepted', resolved_at = $1 WHERE id = $2`
	_, err = h.db.Pool.Exec(context.Background(), updateReport, time.Now(), reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update report status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report accepted and location updated"})
}

func (h *PhotoHandler) RejectReport(c *gin.Context) {
	reportID := c.Param("id")

	query := `UPDATE location_reports SET status = 'rejected', resolved_at = $1 WHERE id = $2 AND status = 'pending'`
	result, err := h.db.Pool.Exec(context.Background(), query, time.Now(), reportID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject report"})
		return
	}

	if result.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Report not found or already resolved"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Report rejected"})
}
