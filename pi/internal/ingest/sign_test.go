package ingest

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// vector is one entry of the shared fixture, written by scripts/gen-pi-hmac-vectors.py.
type vector struct {
	Name              string `json:"name"`
	KeyHex            string `json:"key_hex"`
	Timestamp         int64  `json:"timestamp"`
	BodyHex           string `json:"body_hex"`
	ExpectedSignature string `json:"expected_signature"`
}

func loadVectors(t *testing.T) []vector {
	t.Helper()
	b, err := os.ReadFile("../../../tests/fixtures/pi/hmac-vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var vs []vector
	if err := json.Unmarshal(b, &vs); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	if len(vs) < 4 {
		t.Fatalf("want at least 4 vectors, got %d", len(vs))
	}
	return vs
}

func TestSignMatchesSharedVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			key, err := hex.DecodeString(v.KeyHex)
			if err != nil {
				t.Fatalf("key_hex: %v", err)
			}
			body, err := hex.DecodeString(v.BodyHex)
			if err != nil {
				t.Fatalf("body_hex: %v", err)
			}
			if got := Sign(key, v.Timestamp, body); got != v.ExpectedSignature {
				t.Errorf("Sign = %s, want %s", got, v.ExpectedSignature)
			}
		})
	}
}

func TestSignDependsOnEveryInput(t *testing.T) {
	key, body := []byte("0123456789abcdef0123456789abcdef"), []byte("feed")
	base := Sign(key, 1790000000, body)
	for name, other := range map[string]string{
		"key":       Sign([]byte("0123456789abcdef0123456789abcdeF"), 1790000000, body),
		"timestamp": Sign(key, 1790000001, body),
		"body":      Sign(key, 1790000000, []byte("feeD")),
	} {
		if other == base {
			t.Errorf("changing the %s did not change the signature", name)
		}
	}
}
