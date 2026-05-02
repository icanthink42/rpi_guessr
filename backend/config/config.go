package config

import (
	"os"
)

type Config struct {
	DatabaseURL      string
	S3Bucket         string
	S3Region         string
	S3Endpoint       string
	S3PublicEndpoint string
	Port             string
	GoogleClientID   string
	AllowedDomain    string
}

func Load() *Config {
	endpoint := getEnv("AWS_ENDPOINT_URL", "")
	publicEndpoint := getEnv("S3_PUBLIC_ENDPOINT", endpoint)

	return &Config{
		DatabaseURL:      getEnv("DATABASE_URL", "postgres://localhost:5432/rpi_guessr?sslmode=disable"),
		S3Bucket:         getEnv("S3_BUCKET", "rpi-guessr-photos"),
		S3Region:         getEnv("S3_REGION", "us-east-1"),
		S3Endpoint:       endpoint,
		S3PublicEndpoint: publicEndpoint,
		Port:             getEnv("PORT", "8080"),
		GoogleClientID:   getEnv("GOOGLE_CLIENT_ID", ""),
		AllowedDomain:    getEnv("ALLOWED_DOMAIN", ""),
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}
