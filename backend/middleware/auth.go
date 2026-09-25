package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type AuthMiddleware struct {
	clientID      string
	allowedDomain string
	allowedEmails map[string]struct{}
}

type TokenInfo struct {
	Aud           string `json:"aud"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Exp           string `json:"exp"`
}

func NewAuthMiddleware(clientID, allowedDomain, allowedEmails string) *AuthMiddleware {
	auth := &AuthMiddleware{
		clientID:      clientID,
		allowedDomain: strings.ToLower(strings.TrimSpace(allowedDomain)),
		allowedEmails: make(map[string]struct{}),
	}
	for _, email := range strings.Split(allowedEmails, ",") {
		email = strings.ToLower(strings.TrimSpace(email))
		if email != "" {
			auth.allowedEmails[email] = struct{}{}
		}
	}
	return auth
}

func (a *AuthMiddleware) isAuthorizedEmail(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	if _, ok := a.allowedEmails[email]; ok {
		return true
	}
	if a.allowedDomain != "" {
		return strings.HasSuffix(email, "@"+a.allowedDomain)
	}
	return len(a.allowedEmails) == 0
}

func (a *AuthMiddleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip auth if no client ID configured (local dev without auth)
		if a.clientID == "" {
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header format"})
			c.Abort()
			return
		}

		// Verify token with Google's tokeninfo endpoint
		resp, err := http.Get(fmt.Sprintf("https://oauth2.googleapis.com/tokeninfo?id_token=%s", tokenString))
		if err != nil || resp.StatusCode != http.StatusOK {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}
		defer resp.Body.Close()

		var tokenInfo TokenInfo
		if err := json.NewDecoder(resp.Body).Decode(&tokenInfo); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "failed to decode token"})
			c.Abort()
			return
		}

		// Verify audience matches our client ID
		if tokenInfo.Aud != a.clientID {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token audience"})
			c.Abort()
			return
		}

		// Allow members of the configured domain or explicitly listed email addresses.
		if !a.isAuthorizedEmail(tokenInfo.Email) {
			c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized email"})
			c.Abort()
			return
		}

		c.Set("email", tokenInfo.Email)
		c.Next()
	}
}
