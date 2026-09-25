package config

import "strings"

// AdminEmails is the version-controlled allowlist for admins outside AllowedDomain.
// Add new addresses here so admin access changes are reviewed with the code.
var AdminEmails = []string{
	"andyciambella33@gmail.com",
}

func loadAllowedEmails() string {
	emails := append([]string(nil), AdminEmails...)
	if additionalEmails := strings.TrimSpace(getEnv("ALLOWED_EMAILS", "")); additionalEmails != "" {
		emails = append(emails, additionalEmails)
	}
	return strings.Join(emails, ",")
}
