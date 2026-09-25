package middleware

import "testing"

func TestIsAuthorizedEmail(t *testing.T) {
	auth := NewAuthMiddleware(
		"client-id",
		"rpi.edu",
		"andyciambella33@gmail.com, second@example.com",
	)

	tests := []struct {
		name  string
		email string
		want  bool
	}{
		{name: "allowed domain", email: "student@rpi.edu", want: true},
		{name: "explicit email", email: "andyciambella33@gmail.com", want: true},
		{name: "explicit email is case insensitive", email: "AndyCiambella33@Gmail.com", want: true},
		{name: "second explicit email", email: "second@example.com", want: true},
		{name: "unlisted email", email: "someone@gmail.com", want: false},
		{name: "domain suffix spoof", email: "student@notrpi.edu", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := auth.isAuthorizedEmail(tt.email); got != tt.want {
				t.Fatalf("isAuthorizedEmail(%q) = %v, want %v", tt.email, got, tt.want)
			}
		})
	}
}

func TestIsAuthorizedEmailWithoutRestrictions(t *testing.T) {
	auth := NewAuthMiddleware("client-id", "", "")
	if !auth.isAuthorizedEmail("anyone@example.com") {
		t.Fatal("email should be allowed when no domain or email allowlist is configured")
	}
}

func TestIsAuthorizedEmailWithEmailAllowlistOnly(t *testing.T) {
	auth := NewAuthMiddleware("client-id", "", "admin@example.com")
	if !auth.isAuthorizedEmail("admin@example.com") {
		t.Fatal("explicitly listed email should be allowed")
	}
	if auth.isAuthorizedEmail("anyone@example.com") {
		t.Fatal("unlisted email should be rejected when an email allowlist is configured")
	}
}
