//go:build openmtp_manual

package send_to_js

import (
	"github.com/ganeshrvel/go-mtpx"
	"testing"
	"time"
)

func TestCallbackEnvelopePreservesWireShape(t *testing.T) {
	cases := []struct {
		name   string
		result Result
		want   string
	}{
		{"success", Result{Data: true}, `{"errorType":"","error":"","data":true}`},
		{"empty list", Result{Data: []FileInfo{}}, `{"errorType":"","error":"","data":[]}`},
		{"nil list", Result{Data: []FileInfo(nil)}, `{"errorType":"","error":"","data":null}`},
		{"error", Result{ErrorType: ErrorGeneral, Error: "failure"}, `{"errorType":"ErrorGeneral","error":"failure","data":null}`},
		{"file", Result{Data: []FileInfo{{Size: 12, Name: "café.txt", FullPath: "/café.txt", ModTime: "2026-10-02 12:30:00", Extension: ".txt"}}}, `{"errorType":"","error":"","data":[{"size":12,"isFolder":false,"dateAdded":"2026-10-02 12:30:00","name":"café.txt","path":"/café.txt","extension":".txt"}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := toJson(tc.result); got != tc.want {
				t.Fatalf("wire mismatch: got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestListingTimeUsesUTCWithoutChangingInstant(t *testing.T) {
	instant := time.Date(2026, 10, 2, 15, 0, 3, 0, time.UTC)
	for _, zone := range []*time.Location{time.UTC, time.FixedZone("IST", 19800), time.FixedZone("PDT", -25200)} {
		t.Run(zone.String(), func(t *testing.T) {
			file := &mtpx.FileInfo{Name: "photo.jpg", FullPath: "/DCIM/photo.jpg", Extension: ".jpg", Size: 1024, ModTime: instant.In(zone)}
			got := NewFileInfo(file)
			if got.ModTime != "2026-10-02T15:00:03.000Z" {
				t.Fatalf("incorrect UTC wire date: %s", got.ModTime)
			}
			if got.Name != file.Name || got.FullPath != file.FullPath || got.Size != file.Size || got.IsDir || got.Extension != file.Extension {
				t.Fatal("listing metadata changed")
			}
		})
	}
}
