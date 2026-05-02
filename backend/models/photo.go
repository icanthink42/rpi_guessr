package models

import (
	"time"
)

type Photo struct {
	ID        string    `json:"id"`
	S3Key     string    `json:"s3_key"`
	S3Bucket  string    `json:"s3_bucket"`
	Longitude float64   `json:"longitude"`
	Latitude  float64   `json:"latitude"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RandomPhotoResponse struct {
	ID       string `json:"id"`
	PhotoURL string `json:"photo_url"`
}

type PhotoInfoResponse struct {
	ID        string    `json:"id"`
	Longitude float64   `json:"longitude"`
	Latitude  float64   `json:"latitude"`
	CreatedAt time.Time `json:"created_at"`
}

type GuessRequest struct {
	Longitude float64 `json:"longitude" binding:"required"`
	Latitude  float64 `json:"latitude" binding:"required"`
}

type Location struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

type GuessResponse struct {
	DistanceKm     float64 `json:"distance_km"`
	Points         int     `json:"points"`
	ActualLocation struct {
		Longitude float64 `json:"longitude"`
		Latitude  float64 `json:"latitude"`
	} `json:"actual_location"`
	OtherGuesses []Location `json:"other_guesses,omitempty"`
}

type PhotoListItem struct {
	ID        string    `json:"id"`
	PhotoURL  string    `json:"photo_url"`
	Longitude float64   `json:"longitude"`
	Latitude  float64   `json:"latitude"`
	CreatedAt time.Time `json:"created_at"`
}

// Game models

type Game struct {
	ID           string     `json:"id"`
	PlayerName   string     `json:"player_name"`
	Mode         int        `json:"mode"` // 5, 10, or 20 rounds
	TotalScore   int        `json:"total_score"`
	RoundsPlayed int        `json:"rounds_played"`
	Completed    bool       `json:"completed"`
	CreatedAt    time.Time  `json:"created_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

type CreateGameRequest struct {
	PlayerName string `json:"player_name" binding:"required"`
	Mode       int    `json:"mode" binding:"required"`
}

type GameResponse struct {
	ID           string               `json:"id"`
	PlayerName   string               `json:"player_name"`
	Mode         int                  `json:"mode"`
	TotalScore   int                  `json:"total_score"`
	RoundsPlayed int                  `json:"rounds_played"`
	Completed    bool                 `json:"completed"`
	CurrentPhoto *RandomPhotoResponse `json:"current_photo,omitempty"`
}

type GameGuessRequest struct {
	PhotoID   string  `json:"photo_id" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
	Latitude  float64 `json:"latitude" binding:"required"`
}

type GameGuessResponse struct {
	DistanceKm     float64 `json:"distance_km"`
	Points         int     `json:"points"`
	TotalScore     int     `json:"total_score"`
	RoundsPlayed   int     `json:"rounds_played"`
	GameCompleted  bool    `json:"game_completed"`
	ActualLocation struct {
		Longitude float64 `json:"longitude"`
		Latitude  float64 `json:"latitude"`
	} `json:"actual_location"`
}

type LeaderboardEntry struct {
	Rank        int       `json:"rank"`
	GameID      string    `json:"game_id"`
	PlayerName  string    `json:"player_name"`
	TotalScore  int       `json:"total_score"`
	CompletedAt time.Time `json:"completed_at"`
}

type LeaderboardResponse struct {
	Mode    int                `json:"mode"`
	Period  string             `json:"period"`
	Entries []LeaderboardEntry `json:"entries"`
}

type GameRound struct {
	Round           int     `json:"round"`
	PhotoID         string  `json:"photo_id"`
	PhotoURL        string  `json:"photo_url"`
	GuessLongitude  float64 `json:"guess_longitude"`
	GuessLatitude   float64 `json:"guess_latitude"`
	ActualLongitude float64 `json:"actual_longitude"`
	ActualLatitude  float64 `json:"actual_latitude"`
	DistanceKm      float64 `json:"distance_km"`
	Points          int     `json:"points"`
}

type GameDetailsResponse struct {
	ID          string      `json:"id"`
	PlayerName  string      `json:"player_name"`
	Mode        int         `json:"mode"`
	TotalScore  int         `json:"total_score"`
	CompletedAt *time.Time  `json:"completed_at,omitempty"`
	Rounds      []GameRound `json:"rounds"`
}

// Location report models

type LocationReport struct {
	ID                 string     `json:"id"`
	PhotoID            string     `json:"photo_id"`
	SuggestedLongitude float64    `json:"suggested_longitude"`
	SuggestedLatitude  float64    `json:"suggested_latitude"`
	Comment            *string    `json:"comment,omitempty"`
	Status             string     `json:"status"`
	CreatedAt          time.Time  `json:"created_at"`
	ResolvedAt         *time.Time `json:"resolved_at,omitempty"`
}

type CreateReportRequest struct {
	Longitude float64 `json:"longitude" binding:"required"`
	Latitude  float64 `json:"latitude" binding:"required"`
	Comment   string  `json:"comment"`
}

type ReportListItem struct {
	ID                 string    `json:"id"`
	PhotoID            string    `json:"photo_id"`
	PhotoURL           string    `json:"photo_url"`
	CurrentLongitude   float64   `json:"current_longitude"`
	CurrentLatitude    float64   `json:"current_latitude"`
	SuggestedLongitude float64   `json:"suggested_longitude"`
	SuggestedLatitude  float64   `json:"suggested_latitude"`
	Comment            *string   `json:"comment,omitempty"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"created_at"`
}
