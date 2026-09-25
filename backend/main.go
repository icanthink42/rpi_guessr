package main

import (
	"log"

	"rpi_guessr/backend/config"
	"rpi_guessr/backend/database"
	"rpi_guessr/backend/handlers"
	"rpi_guessr/backend/middleware"
	"rpi_guessr/backend/storage"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	s3Storage, err := storage.NewS3Storage(cfg.S3Bucket, cfg.S3Region, cfg.S3Endpoint, cfg.S3PublicEndpoint)
	if err != nil {
		log.Fatalf("Failed to initialize S3 storage: %v", err)
	}

	photoHandler := handlers.NewPhotoHandler(db, s3Storage)
	gameHandler := handlers.NewGameHandler(db, s3Storage)
	authMiddleware := middleware.NewAuthMiddleware(cfg.GoogleClientID, cfg.AllowedDomain, cfg.AllowedEmails)

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins: true,
		AllowMethods:    []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:    []string{"Origin", "Content-Type", "Authorization"},
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api")
	{
		// Public routes
		api.GET("/photos/random", photoHandler.GetRandomPhoto)
		api.POST("/photos/:id/guess", photoHandler.SubmitGuess)
		api.POST("/photos/:id/report", photoHandler.SubmitReport)

		// Game routes
		api.POST("/games", gameHandler.CreateGame)
		api.GET("/games/:id", gameHandler.GetGame)
		api.POST("/games/:id/guess", gameHandler.SubmitGuess)
		api.GET("/games/:id/details", gameHandler.GetGameDetails)
		api.GET("/leaderboard", gameHandler.GetLeaderboard)

		// Admin routes (require auth)
		admin := api.Group("")
		admin.Use(authMiddleware.RequireAuth())
		{
			admin.GET("/photos", photoHandler.ListPhotos)
			admin.POST("/photos", photoHandler.UploadPhoto)
			admin.GET("/photos/:id/guesses", photoHandler.GetPhotoGuesses)
			admin.PUT("/photos/:id/location", photoHandler.UpdatePhotoLocation)
			admin.DELETE("/photos/:id", photoHandler.DeletePhoto)

			// Report management
			admin.GET("/reports", photoHandler.ListReports)
			admin.POST("/reports/:id/accept", photoHandler.AcceptReport)
			admin.POST("/reports/:id/reject", photoHandler.RejectReport)

			// Game management
			admin.GET("/games", gameHandler.ListGames)
			admin.PUT("/games/:id", gameHandler.UpdateGame)
			admin.DELETE("/games/:id", gameHandler.DeleteGame)
		}
	}

	log.Printf("Server starting on port %s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
