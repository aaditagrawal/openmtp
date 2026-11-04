package main

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/ganeshrvel/go-mtpfs/mtp"
	"github.com/ganeshrvel/go-mtpx"
	"kalam/send_to_js"
)

func TestBatchedListingOptIn(t *testing.T) {
	info := &mtp.DeviceInfo{OperationsSupported: []uint16{mtp.OC_MTP_GetObjPropList}}
	for _, env := range []string{"", "0", "true", "1"} {
		t.Setenv("OPENMTP_BATCHED_LISTING", env)
		if got := useBatchedListing(false, info); got != (env == "1") {
			t.Fatalf("opt-in %q: %t", env, got)
		}
		if useBatchedListing(true, info) || useBatchedListing(false, nil) || useBatchedListing(false, &mtp.DeviceInfo{}) {
			t.Fatal("recursive or unsupported listing enabled")
		}
	}
}

func TestBatchedBrowsingWireAndFilters(t *testing.T) {
	modified := time.Date(2026, 1, 2, 3, 4, 5, 0, time.FixedZone("IST", 19800))
	entries := []mtp.DirectoryMetadata{
		{Name: "archive.tar.gz", Size: 5<<30 + 7, Modified: modified},
		{Name: "Folder.ext", IsDir: true, Modified: modified},
		{Name: ".hidden", Size: 1}, {Name: ".DS_Store"},
		{Name: "[-----DS_Store.mtp.test----].txt"}, {Name: ".ds_store"},
	}
	for _, parent := range []string{"/", "/DCIM//Camera/", "DCIM/Camera"} {
		got := browsingFiles(entries[:2], parent, false, false)
		// Fixed expected values follow the pinned mtpx FileInfo and wire rules.
		prefix := "/DCIM/Camera/"
		if parent == "/" {
			prefix = "/"
		}
		want := []send_to_js.FileInfo{
			{Size: 5<<30 + 7, ModTime: "2026-01-01T21:34:05.000Z", Name: "archive.tar.gz", FullPath: prefix + "archive.tar.gz", Extension: "tar.gz"},
			{IsDir: true, ModTime: "2026-01-01T21:34:05.000Z", Name: "Folder.ext", FullPath: prefix + "Folder.ext"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("parent %q: got %+v, want %+v", parent, got, want)
		}
	}
	for _, tc := range []struct {
		hidden, disallowed bool
		names              []string
	}{
		{false, false, []string{"archive.tar.gz", "Folder.ext", ".hidden", ".DS_Store", "[-----DS_Store.mtp.test----].txt", ".ds_store"}},
		{true, false, []string{"archive.tar.gz", "Folder.ext", "[-----DS_Store.mtp.test----].txt"}},
		{false, true, []string{"archive.tar.gz", "Folder.ext", ".hidden", ".ds_store"}},
		{true, true, []string{"archive.tar.gz", "Folder.ext"}},
	} {
		var names []string
		for _, fi := range browsingFiles(entries, "/", tc.disallowed, tc.hidden) {
			names = append(names, fi.Name)
		}
		if !reflect.DeepEqual(names, tc.names) {
			t.Fatalf("filters %+v: %v", tc, names)
		}
	}
	files := browsingFiles(nil, "/", true, true)
	data, err := json.Marshal(files)
	if err != nil || string(data) != "null" {
		t.Fatalf("empty wire changed: %s %v", data, err)
	}
	// NewFileInfo remains the shared serializer.
	if got := browsingFiles(entries[:1], "/", false, false)[0]; got != send_to_js.NewFileInfo(&mtpx.FileInfo{Name: "archive.tar.gz", Size: 5<<30 + 7, FullPath: "/archive.tar.gz", Extension: "tar.gz", ModTime: modified}) {
		t.Fatal("wire projection diverged")
	}
}

func TestBrowsingExtensions(t *testing.T) {
	for name, want := range map[string]string{"file": "", ".hidden": "hidden", "a.tar.gz": "tar.gz", "a.TAR.gz": "gz", "a.b.ZIP": "ZIP", "file.": ""} {
		if got := browsingExtension(name, false); got != want {
			t.Fatalf("%q: %q, want %q", name, got, want)
		}
		if browsingExtension(name, true) != "" {
			t.Fatal("directory extension")
		}
	}
}

type fakeBrowsingDevice struct {
	handleErr, metadataErr error
	fallback               bool
	calls                  []string
}

func (f *fakeBrowsingDevice) GetObjectHandles(storage, format, parent uint32, handles *mtp.Uint32Array) error {
	f.calls = append(f.calls, "handles")
	if storage != 3 || format != mtp.GOH_ALL_ASSOCS || parent != 7 {
		panic("incorrect enumeration scope")
	}
	handles.Values = []uint32{9}
	return f.handleErr
}

func (f *fakeBrowsingDevice) TryDirectoryMetadata(info *mtp.DeviceInfo, storage, parent uint32, handles []uint32) ([]mtp.DirectoryMetadata, bool, error) {
	f.calls = append(f.calls, "properties")
	if storage != 3 || parent != 7 || !reflect.DeepEqual(handles, []uint32{9}) {
		panic("incorrect metadata scope")
	}
	if f.metadataErr != nil {
		return nil, true, f.metadataErr
	}
	if f.fallback {
		return nil, false, nil
	}
	return []mtp.DirectoryMetadata{{Handle: 9, Name: "photo.jpg", Size: 10}}, true, nil
}

func TestBatchedWalkBoundary(t *testing.T) {
	failure := errors.New("transport failed")
	for _, tc := range []struct {
		name                                string
		parent                              mtpx.FileInfo
		resolveErr, handlesErr, metadataErr error
		fallback                            bool
		wantCalls                           []string
		handled, wantErr                    bool
	}{
		{name: "success", parent: mtpx.FileInfo{IsDir: true, ObjectId: 7}, wantCalls: []string{"handles", "properties"}, handled: true},
		{name: "file path", parent: mtpx.FileInfo{ObjectId: 7}},
		{name: "disallowed target", parent: mtpx.FileInfo{IsDir: true, ObjectId: 7, Name: ".DS_Store"}},
		{name: "invalid path", resolveErr: failure, handled: true, wantErr: true},
		{name: "handles failed", parent: mtpx.FileInfo{IsDir: true, ObjectId: 7}, handlesErr: failure, wantCalls: []string{"handles"}, handled: true, wantErr: true},
		{name: "properties failed", parent: mtpx.FileInfo{IsDir: true, ObjectId: 7}, metadataErr: failure, wantCalls: []string{"handles", "properties"}, handled: true, wantErr: true},
		{name: "safe fallback", parent: mtpx.FileInfo{IsDir: true, ObjectId: 7}, fallback: true, wantCalls: []string{"handles", "properties"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dev := &fakeBrowsingDevice{handleErr: tc.handlesErr, metadataErr: tc.metadataErr, fallback: tc.fallback}
			resolve := func(storage uint32, path string) (*mtpx.FileInfo, error) {
				if storage != 3 || path != "/DCIM" {
					t.Fatal("resolver scope changed")
				}
				return &tc.parent, tc.resolveErr
			}
			files, handled, err := tryBatchedWalkOn(dev, nil, resolve, 3, "/DCIM", true, true)
			if handled != tc.handled || (err != nil) != tc.wantErr || !reflect.DeepEqual(dev.calls, tc.wantCalls) {
				t.Fatalf("handled=%t err=%v calls=%v", handled, err, dev.calls)
			}
			if tc.wantErr && (!errors.Is(err, failure) || files != nil) {
				t.Fatalf("failure swallowed: %v %v", files, err)
			}
			if tc.name == "success" && (len(files) != 1 || files[0].FullPath != "/DCIM/photo.jpg") {
				t.Fatalf("wrong browsing result: %+v", files)
			}
		})
	}
}
