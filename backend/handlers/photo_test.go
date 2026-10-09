package handlers

import "testing"

func TestParseManualLocation(t *testing.T) {
	tests := []struct {
		name    string
		lat     string
		lon     string
		wantOK  bool
		wantErr bool
	}{
		{name: "not provided", lat: "", lon: "", wantOK: false},
		{name: "valid", lat: "42.7302", lon: "-73.6788", wantOK: true},
		{name: "surrounding whitespace", lat: " 42.7302 ", lon: " -73.6788 ", wantOK: true},
		{name: "missing longitude", lat: "42.7302", lon: "", wantErr: true},
		{name: "missing latitude", lat: "", lon: "-73.6788", wantErr: true},
		{name: "not a number", lat: "abc", lon: "-73.6788", wantErr: true},
		{name: "NaN", lat: "NaN", lon: "-73.6788", wantErr: true},
		{name: "infinite", lat: "42.7302", lon: "Inf", wantErr: true},
		{name: "latitude out of range", lat: "91", lon: "-73.6788", wantErr: true},
		{name: "longitude out of range", lat: "42.7302", lon: "-181", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lat, lon, ok, err := parseManualLocation(tt.lat, tt.lon)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && (lat != 42.7302 || lon != -73.6788) {
				t.Fatalf("got (%v, %v), want (42.7302, -73.6788)", lat, lon)
			}
		})
	}
}
