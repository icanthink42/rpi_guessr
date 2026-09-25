package config

import "testing"

func TestCheckedInAdminEmailsAreLoaded(t *testing.T) {
	t.Setenv("ALLOWED_EMAILS", "")

	if got, want := loadAllowedEmails(), "andyciambella33@gmail.com"; got != want {
		t.Fatalf("loadAllowedEmails() = %q, want %q", got, want)
	}
}

func TestEnvironmentAdminEmailsAreAdded(t *testing.T) {
	t.Setenv("ALLOWED_EMAILS", "another@example.com")

	if got, want := loadAllowedEmails(), "andyciambella33@gmail.com,another@example.com"; got != want {
		t.Fatalf("loadAllowedEmails() = %q, want %q", got, want)
	}
}
